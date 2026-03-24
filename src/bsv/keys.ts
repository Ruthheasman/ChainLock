import { PrivateKey } from '@bsv/sdk'
import { ChainLockConfig, Network } from '../types'

/**
 * Generate a fresh BSV key pair and return a ChainLockConfig.
 */
export function generateKey(network: Network): ChainLockConfig {
  const privKey = PrivateKey.fromRandom()
  const pubKey = privKey.toPublicKey()

  // Address string representation
  const address = pubKey.toAddress().toString()

  return {
    privateKey: privKey.toWif(),
    publicKey: pubKey.toString(),
    address,
    network
  }
}

/**
 * Load a PrivateKey from WIF string.
 */
export function loadPrivateKey(wif: string): PrivateKey {
  return PrivateKey.fromWif(wif)
}

/**
 * Sign arbitrary bytes with a private key.
 * Returns the DER-encoded signature as a hex string.
 */
export function signBytes(data: Buffer, wif: string): string {
  const privKey = PrivateKey.fromWif(wif)
  // @bsv/sdk sign() accepts number[] and returns a Signature object
  const bytes: number[] = Array.from(data)
  const sig = privKey.sign(bytes)
  return Buffer.from(sig.toDER()).toString('hex')
}

/**
 * Verify a hex DER signature against the given bytes and public key hex.
 */
export function verifySignature(data: Buffer, sigHex: string, pubKeyHex: string): boolean {
  try {
    const { PublicKey, Signature } = require('@bsv/sdk')
    const pubKey = PublicKey.fromString(pubKeyHex)
    const sig = Signature.fromDER(Array.from(Buffer.from(sigHex, 'hex')))
    const bytes: number[] = Array.from(data)
    return pubKey.verify(bytes, sig)
  } catch {
    return false
  }
}

/**
 * Returns true if the given string is a valid compressed public key (66 hex chars).
 */
export function isValidPublicKey(hex: string): boolean {
  if (!/^[0-9a-fA-F]{66}$/.test(hex)) return false
  try {
    const { PublicKey } = require('@bsv/sdk')
    PublicKey.fromString(hex)
    return true
  } catch {
    return false
  }
}
