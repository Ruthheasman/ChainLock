import { PackageRecord, PendingRelease, Registry, Network } from '../types'
import { recordHash, sha256 } from '../utils/hash'
import { signBytes, verifySignature } from './keys'

export const CHAINLOCK_OP_RETURN_PREFIX = 'CHAINLOCK_V1:'
export const CHAINLOCK_INDEX_ADDRESS_MAINNET = '1ChainLockXXXXXXXXXXXXXXXXXXXXXX'  // placeholder
export const CHAINLOCK_INDEX_ADDRESS_TESTNET = 'mzChainLockXXXXXXXXXXXXXXXXXXXXXX' // placeholder

/**
 * Build a new PackageRecord (unsigned — sigs=[]).
 */
export function buildRecord(params: {
  pkg: string
  ver: string
  reg: Registry
  src: string
  art: string
  diff?: string
  maintainerPubs: string[]
  threshold: number
}): PackageRecord {
  const { pkg, ver, reg, src, art, diff, maintainerPubs, threshold } = params
  return {
    cl: '1',
    pkg,
    ver,
    reg,
    src,
    art,
    ...(diff !== undefined ? { diff } : {}),
    ts: Math.floor(Date.now() / 1000),
    ms: `${threshold}/${maintainerPubs.length}`,
    pubs: [...maintainerPubs],
    sigs: []
  }
}

/**
 * Create a PendingRelease from a freshly built record.
 */
export function createPendingRelease(record: PackageRecord, network: Network): PendingRelease {
  return {
    record,
    recordHash: recordHash(record),
    network
  }
}

/**
 * Add a maintainer's signature to a PendingRelease.
 * Returns a new PendingRelease with the signature appended.
 * Throws if the public key isn't in the record's `pubs` list or has already signed.
 */
export function addSignature(
  pending: PendingRelease,
  pubKeyHex: string,
  wif: string
): PendingRelease {
  const { record, recordHash: hash } = pending

  const pubIndex = record.pubs.indexOf(pubKeyHex)
  if (pubIndex === -1) {
    throw new Error(`Public key ${pubKeyHex} is not a registered maintainer for this package.`)
  }
  if (record.sigs[pubIndex]) {
    throw new Error(`Key ${pubKeyHex} has already signed this release.`)
  }

  const hashBuf = Buffer.from(hash, 'hex')
  const sig = signBytes(hashBuf, wif)

  // Preserve slot ordering — one sig per pub slot
  const newSigs = [...record.sigs]
  // Fill gaps with empty string up to pubIndex
  while (newSigs.length <= pubIndex) newSigs.push('')
  newSigs[pubIndex] = sig

  const newRecord: PackageRecord = { ...record, sigs: newSigs }
  return { ...pending, record: newRecord }
}

/**
 * Verify all signatures in a record against the record hash.
 * Returns { valid: number, required: number, threshold: number }.
 */
export function verifyRecord(record: PackageRecord): {
  valid: number
  required: number
  total: number
  allValid: boolean
  meetsThreshold: boolean
} {
  const [thresholdStr, totalStr] = record.ms.split('/')
  const threshold = parseInt(thresholdStr, 10)
  const total = parseInt(totalStr, 10)

  const hash = recordHash(record)
  const hashBuf = Buffer.from(hash, 'hex')

  let valid = 0
  for (let i = 0; i < record.pubs.length; i++) {
    const sig = record.sigs[i]
    if (!sig) continue
    if (verifySignature(hashBuf, sig, record.pubs[i])) {
      valid++
    }
  }

  return {
    valid,
    required: threshold,
    total,
    allValid: valid === record.pubs.filter((_, i) => !!record.sigs[i]).length,
    meetsThreshold: valid >= threshold
  }
}

/**
 * Encode a PackageRecord to a Buffer for OP_RETURN storage.
 */
export function encodeRecord(record: PackageRecord): Buffer {
  const json = JSON.stringify(record)
  return Buffer.from(CHAINLOCK_OP_RETURN_PREFIX + json, 'utf8')
}

/**
 * Decode a Buffer from OP_RETURN storage back to a PackageRecord.
 * Returns null if the buffer doesn't start with the expected prefix.
 */
export function decodeRecord(data: Buffer): PackageRecord | null {
  const str = data.toString('utf8')
  if (!str.startsWith(CHAINLOCK_OP_RETURN_PREFIX)) return null
  try {
    const json = str.slice(CHAINLOCK_OP_RETURN_PREFIX.length)
    const record = JSON.parse(json)
    if (record.cl !== '1') return null
    return record as PackageRecord
  } catch {
    return null
  }
}

/**
 * Derive a diff hash between two artifact hashes (a simple hash of both).
 */
export function diffHash(prevArtHash: string, newArtHash: string): string {
  return sha256(`${prevArtHash}:${newArtHash}`)
}
