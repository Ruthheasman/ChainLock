export type Network = 'mainnet' | 'testnet'
export type Registry = 'npm' | 'pypi' | 'crates'

/**
 * A ChainLock package record stored on-chain via OP_RETURN.
 * The `sigs` field is populated as maintainers co-sign the release.
 */
export interface PackageRecord {
  cl: '1'                 // ChainLock version marker
  pkg: string             // package name
  ver: string             // package version (semver)
  reg: Registry           // source registry
  src: string             // git commit SHA (pinned source)
  art: string             // sha256 of the published artifact (tarball)
  diff?: string           // sha256 of the diff from previous version
  ts: number              // unix timestamp of record creation
  ms: string              // "m/n" multi-sig threshold e.g. "2/3"
  pubs: string[]          // maintainer public keys (hex compressed secp256k1)
  sigs: string[]          // collected ECDSA signatures (hex), one per pub
}

/**
 * A pending release awaiting co-signatures. Stored locally as JSON
 * and shared with co-maintainers out-of-band.
 */
export interface PendingRelease {
  record: PackageRecord   // record with sigs=[] (or partial sigs)
  recordHash: string      // sha256 of canonical record JSON (sigs excluded)
  network: Network
}

/**
 * Global ChainLock identity config (~/.chainlock/config.json).
 */
export interface ChainLockConfig {
  privateKey: string      // WIF-encoded private key
  publicKey: string       // hex-compressed public key
  address: string         // BSV address
  network: Network
  arcApiKey?: string      // optional ARC broadcaster API key
}

/**
 * Per-package config (./chainlock.json in the package root).
 */
export interface PackageConfig {
  name: string            // package name
  registry: Registry
  maintainers: string[]   // all maintainer public keys (hex)
  threshold: number       // m in m-of-n
  network: Network
}

/**
 * Result of verifying a single installed package.
 */
export interface VerifyResult {
  package: string
  version: string
  status: 'verified' | 'unprotected' | 'mismatch' | 'insufficient_sigs' | 'error'
  txid?: string
  record?: PackageRecord
  details?: string
}

/**
 * A UTXO as returned by WhatsOnChain.
 */
export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string           // hex locking script
}

/**
 * An on-chain record found during a lookup.
 */
export interface OnChainRecord {
  txid: string
  record: PackageRecord
  blockHeight?: number
}
