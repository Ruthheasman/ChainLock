import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { PackageRecord } from '../types'

/**
 * Returns the SHA-256 hex digest of a Buffer or string.
 */
export function sha256(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Returns the SHA-256 hex digest of a file by streaming it.
 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Produces the canonical hash of a PackageRecord, excluding the `sigs` field.
 * This is the data each maintainer signs.
 */
export function recordHash(record: PackageRecord): string {
  const { sigs: _sigs, ...rest } = record  // eslint-disable-line @typescript-eslint/no-unused-vars
  const canonical = JSON.stringify(rest, Object.keys(rest).sort())
  return sha256(canonical)
}

/**
 * Converts a hex string to a Buffer.
 */
export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

/**
 * Converts a Buffer to a hex string.
 */
export function bufferToHex(buf: Buffer): string {
  return buf.toString('hex')
}

/**
 * Converts a hex string to a number array (for @bsv/sdk compatibility).
 */
export function hexToBytes(hex: string): number[] {
  return Array.from(Buffer.from(hex, 'hex'))
}

/**
 * Converts a number array to a hex string.
 */
export function bytesToHex(bytes: number[]): string {
  return Buffer.from(bytes).toString('hex')
}
