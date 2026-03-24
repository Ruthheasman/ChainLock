import { Command } from 'commander'
import { readFileSync, existsSync } from 'fs'
import chalk from 'chalk'
import {
  loadGlobalConfig,
  loadPendingRelease,
  savePendingRelease,
  deletePendingRelease,
  listPendingReleases,
  pendingKey,
  getPendingDir
} from '../utils/config'
import { addSignature, verifyRecord } from '../bsv/record'
import { broadcastRecord } from './publish'
import { printBanner, success, info, warn, error, label } from '../utils/display'
import { PendingRelease } from '../types'
import { join } from 'path'

export function registerSign(program: Command): void {
  program
    .command('sign [package@version]')
    .description('Co-sign a pending package release')
    .option('--file <path>', 'Path to a pending release JSON file')
    .option('--list', 'List all pending releases awaiting co-signature')
    .option('--dry-run', 'Sign but do not broadcast even if threshold is met')
    .action(async (pkgVersion: string | undefined, opts) => {
      printBanner()
      await runSign(pkgVersion, opts)
    })
}

interface SignOptions {
  file?: string
  list?: boolean
  dryRun?: boolean
}

async function runSign(pkgVersion: string | undefined, opts: SignOptions): Promise<void> {
  if (opts.list) {
    return listPending()
  }

  const globalConfig = loadGlobalConfig()

  // ── Load pending release ──────────────────────────────────────────────────
  let pending: PendingRelease

  if (opts.file) {
    if (!existsSync(opts.file)) {
      error(`File not found: ${opts.file}`)
      process.exit(1)
    }
    pending = JSON.parse(readFileSync(opts.file, 'utf8')) as PendingRelease
  } else if (pkgVersion) {
    const [pkg, ver] = pkgVersion.split('@')
    const key = pendingKey(pkg, ver)
    const loaded = loadPendingRelease(key) as PendingRelease | null
    if (!loaded) {
      error(`No pending release found for ${pkgVersion}.`)
      info(`Check ~/.chainlock/pending/ or pass --file <path>`)
      process.exit(1)
    }
    pending = loaded
  } else {
    // Interactive: list and select
    const keys = listPendingReleases()
    if (keys.length === 0) {
      info('No pending releases awaiting your signature.')
      return
    }
    if (keys.length === 1) {
      const loaded = loadPendingRelease(keys[0]) as PendingRelease | null
      if (!loaded) {
        error('Could not load pending release.')
        process.exit(1)
      }
      pending = loaded
    } else {
      const inquirer = (await import('inquirer')).default
      const { choice } = await inquirer.prompt<{ choice: string }>([{
        type: 'list',
        name: 'choice',
        message: 'Which pending release do you want to sign?',
        choices: keys
      }])
      const loaded = loadPendingRelease(choice) as PendingRelease | null
      if (!loaded) {
        error('Could not load pending release.')
        process.exit(1)
      }
      pending = loaded
    }
  }

  const { record, network } = pending

  console.log()
  label('Package', chalk.bold(`${record.pkg}@${record.ver}`))
  label('Registry', record.reg)
  label('Source commit', chalk.cyan(record.src))
  label('Artifact hash', chalk.cyan(record.art))
  label('Threshold', record.ms)
  label('Network', network)
  console.log()

  // ── Verify this key is a registered maintainer ────────────────────────────
  const pubKeyHex = globalConfig.publicKey
  const pubIndex = record.pubs.indexOf(pubKeyHex)

  if (pubIndex === -1) {
    error(`Your key (${pubKeyHex.slice(0, 16)}...) is not a registered maintainer for this package.`)
    info(`Registered maintainers:`)
    record.pubs.forEach((p) => info(`  ${p.slice(0, 32)}...`))
    process.exit(1)
  }

  if (record.sigs[pubIndex]) {
    warn(`You have already signed this release.`)
    const { valid, required } = verifyRecord(record)
    info(`Current signatures: ${valid}/${required}`)
    return
  }

  // ── Sign ──────────────────────────────────────────────────────────────────
  let updated: PendingRelease
  try {
    updated = addSignature(pending, pubKeyHex, globalConfig.privateKey)
  } catch (err) {
    error(`Signing failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  success(`Signed with your key (${pubKeyHex.slice(0, 16)}...)`)

  const { valid, required } = verifyRecord(updated.record)
  info(`Signatures collected: ${valid}/${required}`)

  // ── Save updated pending release ──────────────────────────────────────────
  const key = pendingKey(record.pkg, record.ver)
  savePendingRelease(key, updated)

  if (valid < required) {
    warn(`Still waiting for ${required - valid} more signature(s).`)
    info(`Share updated pending file: ${chalk.cyan(join(getPendingDir(), `${key}.json`))}`)
    return
  }

  // ── Threshold met — broadcast ─────────────────────────────────────────────
  console.log()
  success('Signature threshold met! Broadcasting to BSV blockchain...')
  await broadcastRecord(updated.record, globalConfig.privateKey, network, opts.dryRun)

  // Clean up pending release
  deletePendingRelease(key)
}

function listPending(): void {
  const keys = listPendingReleases()
  if (keys.length === 0) {
    info('No pending releases.')
    return
  }
  console.log()
  console.log(chalk.bold(`  ${keys.length} pending release(s):`))
  for (const key of keys) {
    const pending = loadPendingRelease(key) as PendingRelease | null
    if (!pending) continue
    const { valid, required } = verifyRecord(pending.record)
    const statusStr = valid >= required
      ? chalk.green(`${valid}/${required} ✓`)
      : chalk.yellow(`${valid}/${required}`)
    console.log(`  ${chalk.cyan(key.padEnd(40))} ${statusStr} signatures`)
  }
  console.log()
}
