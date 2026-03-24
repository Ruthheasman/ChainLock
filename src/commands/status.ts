import { Command } from 'commander'
import chalk from 'chalk'
import { listPendingReleases, loadPendingRelease } from '../utils/config'
import { verifyRecord } from '../bsv/record'
import { printBanner, info, label } from '../utils/display'
import { PendingRelease } from '../types'

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show pending releases and their co-signature status')
    .action(async () => {
      printBanner()
      await runStatus()
    })
}

async function runStatus(): Promise<void> {
  const keys = listPendingReleases()

  if (keys.length === 0) {
    info('No pending releases.')
    return
  }

  console.log(chalk.bold(`\n  Pending releases (${keys.length})\n`))

  for (const key of keys) {
    const pending = loadPendingRelease(key) as PendingRelease | null
    if (!pending) continue

    const { record, network } = pending
    const { valid, required } = verifyRecord(record)
    const ready = valid >= required

    console.log(
      `  ${chalk.bold(record.pkg + '@' + record.ver)}` +
      ` ${chalk.dim('(' + network + ')')}`
    )
    label('  Registry', record.reg)
    label('  Source', record.src.slice(0, 12) + '...')
    label('  Artifact', record.art.slice(0, 16) + '...')
    label(
      '  Signatures',
      ready
        ? chalk.green(`${valid}/${required} ✓ ready to broadcast`)
        : chalk.yellow(`${valid}/${required} — waiting for ${required - valid} more`)
    )
    label('  Created', new Date(record.ts * 1000).toISOString())

    console.log()
    console.log(chalk.dim('  Maintainers:'))
    record.pubs.forEach((pub, i) => {
      const signed = !!record.sigs[i]
      const icon = signed ? chalk.green('✓') : chalk.dim('○')
      console.log(`    ${icon} ${pub.slice(0, 24)}...`)
    })
    console.log()
  }
}
