import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'
import { sha256File } from '../utils/hash'

export interface InstalledPackage {
  name: string
  version: string
  resolved?: string   // tarball URL from package-lock.json
  integrity?: string  // SRI hash from package-lock.json
}

/**
 * Read installed packages from package-lock.json (npm v2/v3 format).
 * Falls back to node_modules directory scanning if no lockfile.
 */
export function readInstalledPackages(dir = process.cwd()): InstalledPackage[] {
  const lockPath = join(dir, 'package-lock.json')

  if (existsSync(lockPath)) {
    return parsePackageLock(lockPath)
  }

  // Fall back to reading node_modules directly
  return readFromNodeModules(dir)
}

/**
 * Parse npm lockfile (supports v2 and v3 formats).
 */
function parsePackageLock(lockPath: string): InstalledPackage[] {
  const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as NpmLock
  const packages: InstalledPackage[] = []

  if (raw.packages) {
    // v2/v3 format
    for (const [path, info] of Object.entries(raw.packages)) {
      if (!path || path === '') continue  // skip root entry
      const name = path.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '/')
      if (!name || !info.version) continue
      packages.push({
        name,
        version: info.version,
        resolved: info.resolved,
        integrity: info.integrity
      })
    }
  } else if (raw.dependencies) {
    // v1 format
    for (const [name, info] of Object.entries(raw.dependencies)) {
      if (!info.version) continue
      packages.push({
        name,
        version: info.version,
        resolved: info.resolved,
        integrity: info.integrity
      })
    }
  }

  return packages
}

/**
 * Read package names and versions from node_modules package.json files.
 */
function readFromNodeModules(dir: string): InstalledPackage[] {
  const nodeModules = join(dir, 'node_modules')
  if (!existsSync(nodeModules)) return []

  const packages: InstalledPackage[] = []
  try {
    const { readdirSync } = require('fs')
    const entries = readdirSync(nodeModules) as string[]

    for (const entry of entries) {
      if (entry.startsWith('.')) continue

      if (entry.startsWith('@')) {
        // Scoped package namespace
        const scopedPath = join(nodeModules, entry)
        try {
          const scoped = readdirSync(scopedPath) as string[]
          for (const sub of scoped) {
            tryReadPackageJson(join(scopedPath, sub), `${entry}/${sub}`, packages)
          }
        } catch { /* skip */ }
      } else {
        tryReadPackageJson(join(nodeModules, entry), entry, packages)
      }
    }
  } catch { /* skip */ }

  return packages
}

function tryReadPackageJson(
  pkgDir: string,
  name: string,
  packages: InstalledPackage[]
): void {
  const pkgJson = join(pkgDir, 'package.json')
  if (!existsSync(pkgJson)) return
  try {
    const meta = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: string }
    if (meta.version) {
      packages.push({ name, version: meta.version })
    }
  } catch { /* skip */ }
}

/**
 * Compute the SHA-256 hash of a locally installed package's tarball.
 * Re-packs it using `npm pack --dry-run` and hashes the resulting tarball.
 */
export async function computePackageHash(
  packageName: string,
  dir = process.cwd()
): Promise<string | null> {
  const pkgDir = resolve(dir, 'node_modules', packageName)
  if (!existsSync(pkgDir)) return null

  try {
    // Use npm pack to create a deterministic tarball
    const output = execSync(`npm pack --dry-run --json 2>/dev/null`, {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    })
    const info = JSON.parse(output) as Array<{ filename: string }>
    if (info[0]?.filename) {
      const tarball = join(pkgDir, info[0].filename)
      if (existsSync(tarball)) {
        return sha256File(tarball)
      }
    }
  } catch {
    // Fall back to hashing installed directory
  }

  // Fall back: hash all files in the package directory
  return hashDirectory(pkgDir)
}

/**
 * Hash the contents of a directory by concatenating file hashes.
 */
async function hashDirectory(dir: string): Promise<string> {
  const { createHash } = await import('crypto')
  const { readdirSync, statSync } = await import('fs')

  const hash = createHash('sha256')

  function addDir(d: string): void {
    let entries: string[]
    try {
      entries = readdirSync(d).sort()
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(d, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) {
          addDir(full)
        } else {
          hash.update(entry)
          hash.update(readFileSync(full))
        }
      } catch { /* skip */ }
    }
  }

  addDir(dir)
  return hash.digest('hex')
}

/**
 * Get the git commit SHA of the current working directory.
 */
export function getCurrentGitCommit(dir = process.cwd()): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * Get the npm package name from package.json in the given directory.
 */
export function getPackageNameFromJson(dir = process.cwd()): string | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const meta = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }
    return meta.name ?? null
  } catch {
    return null
  }
}

/**
 * Get the npm package version from package.json.
 */
export function getPackageVersionFromJson(dir = process.cwd()): string | null {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const meta = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return meta.version ?? null
  } catch {
    return null
  }
}

// npm lockfile types
interface NpmLock {
  lockfileVersion?: number
  packages?: Record<string, NpmLockPackage>
  dependencies?: Record<string, NpmLockDep>
}

interface NpmLockPackage {
  version?: string
  resolved?: string
  integrity?: string
  dev?: boolean
}

interface NpmLockDep {
  version?: string
  resolved?: string
  integrity?: string
}
