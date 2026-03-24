import inquirer from 'inquirer'
import { Command } from 'commander'
import chalk from 'chalk'
import {
  globalConfigExists,
  loadGlobalConfig,
  saveGlobalConfig,
  packageConfigExists,
  savePackageConfig
} from '../utils/config'
import { generateKey, isValidPublicKey } from '../bsv/keys'
import { printBanner, success, info, warn, label } from '../utils/display'
import { Network, Registry } from '../types'

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialise ChainLock: generate a BSV key pair and configure a package')
    .option('--global-only', 'Only set up the global identity (skip package config)')
    .option('--testnet', 'Use BSV testnet (default)')
    .option('--mainnet', 'Use BSV mainnet')
    .action(async (opts) => {
      printBanner()
      await runInit(opts)
    })
}

async function runInit(opts: { globalOnly?: boolean; testnet?: boolean; mainnet?: boolean }): Promise<void> {
  const network: Network = opts.mainnet ? 'mainnet' : 'testnet'

  // ── Global identity ─────────────────────────────────────────────────────────
  if (globalConfigExists()) {
    const existing = loadGlobalConfig()
    warn(`Global identity already exists (${existing.address})`)

    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([{
      type: 'confirm',
      name: 'overwrite',
      message: 'Overwrite existing identity?',
      default: false
    }])

    if (!overwrite) {
      info('Keeping existing identity.')
    } else {
      const config = generateKey(network)
      saveGlobalConfig(config)
      success('New BSV identity generated and saved to ~/.chainlock/config.json')
      printKeyInfo(config.publicKey, config.address, network)
    }
  } else {
    const config = generateKey(network)
    saveGlobalConfig(config)
    success('BSV identity generated and saved to ~/.chainlock/config.json')
    printKeyInfo(config.publicKey, config.address, network)
  }

  if (opts.globalOnly) return

  // ── Package config ───────────────────────────────────────────────────────────
  console.log()
  console.log(chalk.bold('  Package configuration'))
  console.log(chalk.dim('  (Creates chainlock.json in the current directory)\n'))

  const globalConfig = loadGlobalConfig()

  if (packageConfigExists()) {
    warn('chainlock.json already exists in this directory.')
    const { overwritePkg } = await inquirer.prompt<{ overwritePkg: boolean }>([{
      type: 'confirm',
      name: 'overwritePkg',
      message: 'Overwrite existing package config?',
      default: false
    }])
    if (!overwritePkg) {
      info('Keeping existing chainlock.json.')
      return
    }
  }

  const answers = await inquirer.prompt<{
    name: string
    registry: Registry
    threshold: number
    additionalMaintainers: string
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Package name:',
      validate: (v: string) => v.trim().length > 0 || 'Required'
    },
    {
      type: 'list',
      name: 'registry',
      message: 'Registry:',
      choices: ['npm', 'pypi', 'crates'],
      default: 'npm'
    },
    {
      type: 'input',
      name: 'additionalMaintainers',
      message: 'Co-maintainer public keys (comma-separated hex, leave blank for solo):',
      default: ''
    },
    {
      type: 'number',
      name: 'threshold',
      message: 'Signatures required to publish (m-of-n):',
      default: 1
    }
  ])

  const additionalPubs = answers.additionalMaintainers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const pub of additionalPubs) {
    if (!isValidPublicKey(pub)) {
      console.error(chalk.red(`  Invalid public key: ${pub}`))
      process.exit(1)
    }
  }

  const maintainers = [globalConfig.publicKey, ...additionalPubs]

  if (answers.threshold < 1 || answers.threshold > maintainers.length) {
    console.error(chalk.red(`  Threshold must be between 1 and ${maintainers.length}`))
    process.exit(1)
  }

  savePackageConfig({
    name: answers.name,
    registry: answers.registry as Registry,
    maintainers,
    threshold: answers.threshold,
    network: globalConfig.network
  })

  success(`Package config saved to chainlock.json`)
  console.log()
  label('Package', answers.name)
  label('Registry', answers.registry)
  label('Threshold', `${answers.threshold}-of-${maintainers.length}`)
  label('Network', network)
  console.log()
  info('Your public key: ' + chalk.cyan(globalConfig.publicKey))
  info('Share this key with co-maintainers so they can be added to packages.')
}

function printKeyInfo(pubKey: string, address: string, network: Network): void {
  console.log()
  label('Public key', chalk.cyan(pubKey))
  label('BSV address', chalk.cyan(address))
  label('Network', network)
  console.log()
  warn('Your private key is stored in ~/.chainlock/config.json — keep it safe!')
}
