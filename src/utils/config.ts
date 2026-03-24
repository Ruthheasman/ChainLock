import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { ChainLockConfig, PackageConfig } from '../types'

const GLOBAL_CONFIG_DIR = join(homedir(), '.chainlock')
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json')
const PACKAGE_CONFIG_FILE = 'chainlock.json'
const PENDING_DIR = join(GLOBAL_CONFIG_DIR, 'pending')

export function getGlobalConfigDir(): string {
  return GLOBAL_CONFIG_DIR
}

export function getPendingDir(): string {
  return PENDING_DIR
}

export function globalConfigExists(): boolean {
  return existsSync(GLOBAL_CONFIG_FILE)
}

export function loadGlobalConfig(): ChainLockConfig {
  if (!existsSync(GLOBAL_CONFIG_FILE)) {
    throw new Error(
      'ChainLock not initialised. Run `chainlock init` first.'
    )
  }
  const raw = readFileSync(GLOBAL_CONFIG_FILE, 'utf8')
  return JSON.parse(raw) as ChainLockConfig
}

export function saveGlobalConfig(config: ChainLockConfig): void {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
  }
  writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
}

export function packageConfigExists(dir = process.cwd()): boolean {
  return existsSync(join(dir, PACKAGE_CONFIG_FILE))
}

export function loadPackageConfig(dir = process.cwd()): PackageConfig {
  const path = join(dir, PACKAGE_CONFIG_FILE)
  if (!existsSync(path)) {
    throw new Error(
      'No chainlock.json found. Run `chainlock init` in the package directory.'
    )
  }
  return JSON.parse(readFileSync(path, 'utf8')) as PackageConfig
}

export function savePackageConfig(config: PackageConfig, dir = process.cwd()): void {
  writeFileSync(join(dir, PACKAGE_CONFIG_FILE), JSON.stringify(config, null, 2), 'utf8')
}

export function loadPendingRelease(key: string): unknown {
  const path = join(PENDING_DIR, `${key}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function savePendingRelease(key: string, data: unknown): void {
  if (!existsSync(PENDING_DIR)) {
    mkdirSync(PENDING_DIR, { recursive: true })
  }
  writeFileSync(join(PENDING_DIR, `${key}.json`), JSON.stringify(data, null, 2), 'utf8')
}

export function deletePendingRelease(key: string): void {
  const path = join(PENDING_DIR, `${key}.json`)
  if (existsSync(path)) {
    const { unlinkSync } = require('fs')
    unlinkSync(path)
  }
}

export function listPendingReleases(): string[] {
  if (!existsSync(PENDING_DIR)) return []
  const { readdirSync } = require('fs')
  return readdirSync(PENDING_DIR)
    .filter((f: string) => f.endsWith('.json'))
    .map((f: string) => f.replace('.json', ''))
}

/** Derive a stable key for a pending release from pkg name + version. */
export function pendingKey(pkg: string, ver: string): string {
  return `${pkg.replace(/\//g, '__')}@${ver}`
}
