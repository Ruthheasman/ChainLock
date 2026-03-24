import { Command } from 'commander'
import chalk from 'chalk'
import { loadGlobalConfig, loadPackageConfig, packageConfigExists } from '../utils/config'
import { lookupPackageRecords } from '../chain/lookup'
import { verifyRecord } from '../bsv/record'
import { readInstalledPackages } from '../registry/npm'
import { printBanner, spinner, printVerifyResults, info, warn, label } from '../utils/display'
import { VerifyResult, Network, OnChainRecord } from '../types'

export function registerVerify(program: Command): void {
  program
    .command('verify [package@version]')
    .description('Verify installed packages against on-chain ChainLock records')
    .option('--strict', 'Fail if any package is unprotected (has no ChainLock record)')
    .option('--fail-on-mismatch', 'Exit non-zero if any package fails verification')
    .option('--network <network>', 'Override network (mainnet|testnet)')
    .option('--json', 'Output results as JSON')
    .action(async (pkgVersion: string | undefined, opts) => {
      if (!opts.json) printBanner()
      await runVerify(pkgVersion, opts)
    })
}

interface VerifyOptions {
  strict?: boolean
  failOnMismatch?: boolean
  network?: string
  json?: boolean
}

async function runVerify(pkgVersion: string | undefined, opts: VerifyOptions): Promise<void> {
  const globalConfig = loadGlobalConfig()
  const network: Network = (opts.network as Network | undefined) ??
    (packageConfigExists() ? loadPackageConfig().network : globalConfig.network)

  if (!opts.json) {
    console.log()
    label('Network', network)
  }

  // ── Determine which packages to verify ───────────────────────────────────
  let packages: Array<{ name: string; version: string }>

  if (pkgVersion) {
    const [name, version] = pkgVersion.split('@')
    packages = [{ name, version }]
  } else {
    const installed = readInstalledPackages()
    if (installed.length === 0) {
      warn('No installed packages found. Are you in a Node.js project?')
      return
    }
    packages = installed.map((p) => ({ name: p.name, version: p.version }))
    if (!opts.json) info(`Verifying ${packages.length} installed packages...`)
  }

  // ── Verify each package ──────────────────────────────────────────────────
  const results: VerifyResult[] = []
  const spin = opts.json ? null : spinner(`Checking packages against BSV ${network}...`)

  const CONCURRENCY = 5
  for (let i = 0; i < packages.length; i += CONCURRENCY) {
    const batch = packages.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((pkg) => verifyPackage(pkg.name, pkg.version, network))
    )
    results.push(...batchResults)
  }

  spin?.stop()

  // ── Output results ────────────────────────────────────────────────────────
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    printVerifyResults(results)
  }

  // ── Exit codes ────────────────────────────────────────────────────────────
  const hasMismatch = results.some(
    (r) => r.status === 'mismatch' || r.status === 'insufficient_sigs' || r.status === 'error'
  )
  const hasUnprotected = results.some((r) => r.status === 'unprotected')

  if (hasMismatch && (opts.failOnMismatch || opts.strict)) {
    process.exit(1)
  }
  if (hasUnprotected && opts.strict) {
    process.exit(1)
  }
}

/**
 * Verify a single package against its on-chain record.
 */
async function verifyPackage(name: string, version: string, network: Network): Promise<VerifyResult> {
  try {
    const records = await lookupPackageRecords(name, version, network)

    if (records.length === 0) {
      return {
        package: name,
        version,
        status: 'unprotected',
        details: 'No ChainLock record found on-chain'
      }
    }

    // Use the most recent matching record
    const best = findBestRecord(records, version)
    if (!best) {
      return {
        package: name,
        version,
        status: 'unprotected',
        details: `No matching record for version ${version}`
      }
    }

    const { meetsThreshold, valid, required } = verifyRecord(best.record)

    if (!meetsThreshold) {
      return {
        package: name,
        version,
        status: 'insufficient_sigs',
        txid: best.txid,
        record: best.record,
        details: `Only ${valid}/${required} required signatures are valid`
      }
    }

    return {
      package: name,
      version,
      status: 'verified',
      txid: best.txid,
      record: best.record
    }
  } catch (err) {
    return {
      package: name,
      version,
      status: 'error',
      details: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Select the best (most recent + matching version) record from a set.
 */
function findBestRecord(records: OnChainRecord[], version: string): OnChainRecord | null {
  const matching = records
    .filter((r) => r.record.ver === version)
    .sort((a, b) => b.record.ts - a.record.ts)

  return matching[0] ?? null
}
