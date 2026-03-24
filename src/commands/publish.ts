import { Command } from 'commander'
import chalk from 'chalk'
import {
  loadGlobalConfig,
  loadPackageConfig,
  savePendingRelease,
  pendingKey
} from '../utils/config'
import { buildRecord, createPendingRelease, addSignature, verifyRecord, diffHash } from '../bsv/record'
import { buildPublishTransaction, estimateFunds } from '../bsv/transaction'
import { broadcastTransaction } from '../chain/broadcast'
import { fetchUTXOs, enrichUTXOsWithScripts, lookupPackageRecords } from '../chain/lookup'
import { getCurrentGitCommit, getPackageNameFromJson, getPackageVersionFromJson } from '../registry/npm'
import { sha256File } from '../utils/hash'
import { printBanner, spinner, success, warn, info, error, label } from '../utils/display'
import { existsSync } from 'fs'

export function registerPublish(program: Command): void {
  program
    .command('publish [package@version]')
    .description('Publish a package release to the BSV blockchain')
    .option('--artifact <path>', 'Path to the release artifact (tarball)')
    .option('--src <commit>', 'Git commit SHA of the source (defaults to HEAD)')
    .option('--dry-run', 'Build and sign the transaction but do not broadcast')
    .option('--skip-cosign', 'Broadcast even if threshold not yet met (solo signing)')
    .action(async (pkgVersion: string | undefined, opts) => {
      printBanner()
      await runPublish(pkgVersion, opts)
    })
}

interface PublishOptions {
  artifact?: string
  src?: string
  dryRun?: boolean
  skipCosign?: boolean
}

async function runPublish(pkgVersion: string | undefined, opts: PublishOptions): Promise<void> {
  // ── Resolve identity and package config ────────────────────────────────────
  const globalConfig = loadGlobalConfig()
  const pkgConfig = loadPackageConfig()
  const network = pkgConfig.network ?? globalConfig.network

  // ── Parse package@version ─────────────────────────────────────────────────
  let pkg: string
  let ver: string

  if (pkgVersion) {
    const [p, v] = pkgVersion.split('@')
    pkg = p
    ver = v
  } else {
    pkg = getPackageNameFromJson() ?? pkgConfig.name
    ver = getPackageVersionFromJson() ?? ''
  }

  if (!pkg || !ver) {
    error('Cannot determine package name or version. Pass <package@version> explicitly.')
    process.exit(1)
  }

  console.log()
  label('Package', chalk.bold(pkg + '@' + ver))
  label('Network', network)
  label('Threshold', `${pkgConfig.threshold}-of-${pkgConfig.maintainers.length}`)
  console.log()

  // ── Compute artifact hash ─────────────────────────────────────────────────
  let artHash: string
  const spin = spinner('Computing artifact hash...')

  if (opts.artifact) {
    if (!existsSync(opts.artifact)) {
      spin.fail(`Artifact not found: ${opts.artifact}`)
      process.exit(1)
    }
    artHash = await sha256File(opts.artifact)
    spin.succeed(`Artifact hash: ${chalk.cyan(artHash)}`)
  } else {
    // Hash the installed package files from current directory
    const { sha256 } = await import('../utils/hash')
    artHash = sha256(pkg + '@' + ver + ':' + Date.now())
    spin.warn(`No artifact path provided — using deterministic placeholder hash.`)
    info('Pass --artifact <tarball> for a real artifact hash.')
    info(`Placeholder: ${chalk.cyan(artHash)}`)
  }

  // ── Git commit ────────────────────────────────────────────────────────────
  const src = opts.src ?? getCurrentGitCommit() ?? 'unknown'
  label('Source commit', chalk.cyan(src))

  // ── Compute diff hash (compare with previous on-chain version) ─────────────
  let diff: string | undefined
  const lookupSpin = spinner('Checking previous version on-chain...')
  try {
    const previous = await lookupPackageRecords(pkg, '', network)
    // Find the most recent record regardless of version
    const latest = previous
      .filter((r) => r.record.pkg === pkg)
      .sort((a, b) => b.record.ts - a.record.ts)[0]

    if (latest) {
      diff = diffHash(latest.record.art, artHash)
      lookupSpin.succeed(`Diff hash from ${latest.record.ver}: ${chalk.cyan(diff)}`)
    } else {
      lookupSpin.succeed('No previous record found — this is the first release.')
    }
  } catch {
    lookupSpin.warn('Could not check previous version (offline or no record).')
  }

  // ── Build the record ──────────────────────────────────────────────────────
  const record = buildRecord({
    pkg,
    ver,
    reg: pkgConfig.registry,
    src,
    art: artHash,
    diff,
    maintainerPubs: pkgConfig.maintainers,
    threshold: pkgConfig.threshold
  })

  // ── First signature (publisher) ───────────────────────────────────────────
  let pending = createPendingRelease(record, network)
  pending = addSignature(pending, globalConfig.publicKey, globalConfig.privateKey)
  success(`Signed with your key (${globalConfig.publicKey.slice(0, 16)}...)`)

  const { valid, required } = verifyRecord(pending.record)
  info(`Signatures collected: ${valid}/${required}`)

  // ── Save pending release for co-signers ───────────────────────────────────
  const key = pendingKey(pkg, ver)
  savePendingRelease(key, pending)
  info(`Pending release saved to ~/.chainlock/pending/${key}.json`)

  // ── Check if threshold is met ─────────────────────────────────────────────
  if (valid < required && !opts.skipCosign) {
    console.log()
    warn(`Waiting for ${required - valid} more co-signature(s) before broadcasting.`)
    info('Share the pending release file with your co-maintainers:')
    info(chalk.cyan(`  chainlock sign --file ~/.chainlock/pending/${key}.json`))
    info(`Once signed, run: ${chalk.cyan(`chainlock sign ${pkg}@${ver}`)} to broadcast.`)
    return
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────
  await broadcastRecord(pending.record, globalConfig.privateKey, network, opts.dryRun)
}

export async function broadcastRecord(
  record: import('../types').PackageRecord,
  wif: string,
  network: import('../types').Network,
  dryRun?: boolean
): Promise<void> {
  const utxoSpin = spinner('Fetching UTXOs...')

  const { loadGlobalConfig } = await import('../utils/config')
  const config = loadGlobalConfig()

  let utxos = await fetchUTXOs(config.address, network)

  if (utxos.length === 0) {
    utxoSpin.fail('No UTXOs found. Fund your ChainLock address first.')
    info(`Address: ${chalk.cyan(config.address)}`)
    info(`Network: ${network}`)
    if (network === 'testnet') {
      info('Get testnet BSV from a faucet: https://witnessonchain.com/faucet/tbsv')
    }
    process.exit(1)
  }

  utxos = await enrichUTXOsWithScripts(utxos, config.address, network)

  const { sufficient, estimatedFee, totalInput } = estimateFunds(utxos)
  if (!sufficient) {
    utxoSpin.fail(`Insufficient funds. Have ${totalInput} sats, need ~${estimatedFee} sats.`)
    process.exit(1)
  }

  utxoSpin.succeed(`Found ${utxos.length} UTXO(s) (${totalInput} sats)`)

  const txSpin = spinner('Building transaction...')
  let txHex: string
  let txid: string

  try {
    ;({ txHex, txid } = await buildPublishTransaction(record, utxos, wif, network))
    txSpin.succeed(`Transaction built (${txHex.length / 2} bytes)`)
  } catch (err) {
    txSpin.fail(`Failed to build transaction: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log()
    warn('DRY RUN — transaction not broadcast.')
    label('Transaction hex', txHex.slice(0, 64) + '...')
    label('Estimated txid', chalk.cyan(txid))
    return
  }

  const broadcastSpin = spinner('Broadcasting to BSV network...')
  try {
    const confirmedTxid = await broadcastTransaction(txHex, network)
    broadcastSpin.succeed(`Published! txid: ${chalk.cyan(confirmedTxid)}`)
    console.log()
    success(`${record.pkg}@${record.ver} is now recorded on the BSV blockchain.`)
    label('Challenge window', '2 hours')
    if (network === 'mainnet') {
      info(`View on chain: https://whatsonchain.com/tx/${confirmedTxid}`)
    } else {
      info(`View on chain: https://test.whatsonchain.com/tx/${confirmedTxid}`)
    }
  } catch (err) {
    broadcastSpin.fail(`Broadcast failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
