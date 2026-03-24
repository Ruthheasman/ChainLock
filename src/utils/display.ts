import chalk from 'chalk'
import ora, { Ora } from 'ora'
import { VerifyResult } from '../types'

export function printBanner(): void {
  console.log(chalk.bold.cyan('\n  ChainLock') + chalk.dim(' — BSV-powered package integrity'))
  console.log(chalk.dim('  https://github.com/Ruthheasman/ChainLock\n'))
}

export function spinner(text: string): Ora {
  return ora({ text, color: 'cyan' }).start()
}

export function success(msg: string): void {
  console.log(chalk.green('  ✓ ') + msg)
}

export function warn(msg: string): void {
  console.log(chalk.yellow('  ⚠ ') + msg)
}

export function error(msg: string): void {
  console.log(chalk.red('  ✗ ') + msg)
}

export function info(msg: string): void {
  console.log(chalk.dim('  → ') + msg)
}

export function label(key: string, value: string): void {
  console.log(`  ${chalk.dim(key.padEnd(20))} ${value}`)
}

export function printVerifyResults(results: VerifyResult[]): void {
  const verified = results.filter((r) => r.status === 'verified')
  const unprotected = results.filter((r) => r.status === 'unprotected')
  const mismatched = results.filter((r) => r.status === 'mismatch' || r.status === 'insufficient_sigs')
  const errored = results.filter((r) => r.status === 'error')

  console.log()

  if (verified.length) {
    console.log(chalk.green(`  ✓ ${verified.length} package${verified.length !== 1 ? 's' : ''} verified`))
  }

  if (unprotected.length) {
    console.log(chalk.yellow(`  ⚠ ${unprotected.length} package${unprotected.length !== 1 ? 's' : ''} have no ChainLock record (unprotected)`))
    for (const r of unprotected) {
      console.log(chalk.dim(`      ${r.package}@${r.version}`))
    }
  }

  if (mismatched.length) {
    console.log(chalk.red(`  ✗ ${mismatched.length} package${mismatched.length !== 1 ? 's' : ''} failed verification`))
    for (const r of mismatched) {
      console.log(chalk.red(`      ${r.package}@${r.version}`) + chalk.dim(` — ${r.details ?? r.status}`))
    }
  }

  if (errored.length) {
    console.log(chalk.red(`  ✗ ${errored.length} package${errored.length !== 1 ? 's' : ''} errored during verification`))
    for (const r of errored) {
      console.log(chalk.red(`      ${r.package}@${r.version}`) + chalk.dim(` — ${r.details ?? 'unknown error'}`))
    }
  }

  console.log()

  if (mismatched.length > 0 || errored.length > 0) {
    process.exitCode = 1
  }
}
