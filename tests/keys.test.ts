import { generateKey, loadPrivateKey, signBytes, verifySignature, isValidPublicKey } from '../src/bsv/keys'

describe('generateKey', () => {
  it('generates a valid mainnet key', () => {
    const config = generateKey('mainnet')
    expect(config.network).toBe('mainnet')
    expect(config.privateKey).toMatch(/^[5KL]/)  // WIF format
    expect(config.publicKey).toMatch(/^0[23][0-9a-f]{64}$/)  // compressed pubkey
    expect(config.address).toBeTruthy()
  })

  it('generates a valid testnet key', () => {
    const config = generateKey('testnet')
    expect(config.network).toBe('testnet')
    expect(config.privateKey).toBeTruthy()
    expect(config.publicKey).toMatch(/^0[23][0-9a-f]{64}$/)
  })

  it('generates unique keys on each call', () => {
    const k1 = generateKey('testnet')
    const k2 = generateKey('testnet')
    expect(k1.privateKey).not.toBe(k2.privateKey)
    expect(k1.publicKey).not.toBe(k2.publicKey)
  })
})

describe('loadPrivateKey', () => {
  it('loads a key from WIF and matches the public key', () => {
    const config = generateKey('testnet')
    const privKey = loadPrivateKey(config.privateKey)
    const pubHex = privKey.toPublicKey().toString()
    expect(pubHex).toBe(config.publicKey)
  })
})

describe('signBytes / verifySignature', () => {
  it('signs and verifies a message', () => {
    const config = generateKey('testnet')
    const data = Buffer.from('hello chainlock')

    const sig = signBytes(data, config.privateKey)
    // DER signatures are 70–72 bytes (140–144 hex chars); just verify non-empty hex
    expect(sig.length).toBeGreaterThanOrEqual(140)
    expect(sig.length).toBeLessThanOrEqual(146)
    expect(sig).toMatch(/^[0-9a-f]+$/)

    const valid = verifySignature(data, sig, config.publicKey)
    expect(valid).toBe(true)
  })

  it('fails verification with wrong public key', () => {
    const key1 = generateKey('testnet')
    const key2 = generateKey('testnet')
    const data = Buffer.from('hello chainlock')

    const sig = signBytes(data, key1.privateKey)
    const valid = verifySignature(data, sig, key2.publicKey)
    expect(valid).toBe(false)
  })

  it('fails verification with tampered data', () => {
    const config = generateKey('testnet')
    const data = Buffer.from('hello chainlock')
    const tampered = Buffer.from('hello TAMPERED')

    const sig = signBytes(data, config.privateKey)
    const valid = verifySignature(tampered, sig, config.publicKey)
    expect(valid).toBe(false)
  })

  it('fails verification with an invalid signature hex', () => {
    const config = generateKey('testnet')
    const data = Buffer.from('hello')
    const valid = verifySignature(data, 'deadbeef', config.publicKey)
    expect(valid).toBe(false)
  })
})

describe('isValidPublicKey', () => {
  it('accepts valid compressed public keys', () => {
    const config = generateKey('testnet')
    expect(isValidPublicKey(config.publicKey)).toBe(true)
  })

  it('rejects keys with wrong length', () => {
    expect(isValidPublicKey('03' + '0'.repeat(60))).toBe(false)  // too short
    expect(isValidPublicKey('03' + '0'.repeat(68))).toBe(false)  // too long
  })

  it('rejects non-hex strings', () => {
    expect(isValidPublicKey('not-a-key')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidPublicKey('')).toBe(false)
  })
})
