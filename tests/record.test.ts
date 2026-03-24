import {
  buildRecord,
  createPendingRelease,
  addSignature,
  verifyRecord,
  encodeRecord,
  decodeRecord,
  diffHash,
  CHAINLOCK_OP_RETURN_PREFIX
} from '../src/bsv/record'
import { generateKey } from '../src/bsv/keys'
import { PackageRecord } from '../src/types'

/** Helper to build a minimal valid record */
function makeRecord(overrides: Partial<PackageRecord> = {}): PackageRecord {
  return buildRecord({
    pkg: 'test-package',
    ver: '1.0.0',
    reg: 'npm',
    src: 'abc123def456',
    art: '0'.repeat(64),
    maintainerPubs: ['03' + '1'.repeat(64)],
    threshold: 1,
    ...overrides
  })
}

describe('buildRecord', () => {
  it('sets the cl version marker to "1"', () => {
    const record = makeRecord()
    expect(record.cl).toBe('1')
  })

  it('sets the correct ms threshold string', () => {
    const record = buildRecord({
      pkg: 'pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'def',
      maintainerPubs: ['03' + '1'.repeat(64), '02' + '2'.repeat(64), '02' + '3'.repeat(64)],
      threshold: 2
    })
    expect(record.ms).toBe('2/3')
  })

  it('starts with empty sigs array', () => {
    expect(makeRecord().sigs).toEqual([])
  })

  it('sets timestamp to a recent unix time', () => {
    const before = Math.floor(Date.now() / 1000) - 5
    const record = makeRecord()
    const after = Math.floor(Date.now() / 1000) + 5
    expect(record.ts).toBeGreaterThanOrEqual(before)
    expect(record.ts).toBeLessThanOrEqual(after)
  })

  it('includes diff when provided', () => {
    const record = buildRecord({
      pkg: 'pkg',
      ver: '2.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'def',
      diff: 'aabbccddeeff',
      maintainerPubs: ['03' + '1'.repeat(64)],
      threshold: 1
    })
    expect(record.diff).toBe('aabbccddeeff')
  })
})

describe('encode / decode record', () => {
  it('roundtrips through encode/decode', () => {
    const record = makeRecord()
    const encoded = encodeRecord(record)
    const decoded = decodeRecord(encoded)

    expect(decoded).not.toBeNull()
    expect(decoded?.pkg).toBe(record.pkg)
    expect(decoded?.ver).toBe(record.ver)
    expect(decoded?.art).toBe(record.art)
    expect(decoded?.cl).toBe('1')
  })

  it('encodes with the correct prefix', () => {
    const record = makeRecord()
    const encoded = encodeRecord(record)
    const str = encoded.toString('utf8')
    expect(str.startsWith(CHAINLOCK_OP_RETURN_PREFIX)).toBe(true)
  })

  it('returns null for non-ChainLock data', () => {
    const result = decodeRecord(Buffer.from('some random data'))
    expect(result).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const result = decodeRecord(Buffer.from(CHAINLOCK_OP_RETURN_PREFIX + '{invalid json}'))
    expect(result).toBeNull()
  })

  it('returns null for wrong cl version', () => {
    const record = { ...makeRecord(), cl: '99' }
    const encoded = Buffer.from(CHAINLOCK_OP_RETURN_PREFIX + JSON.stringify(record))
    const result = decodeRecord(encoded)
    expect(result).toBeNull()
  })
})

describe('signing flow (addSignature / verifyRecord)', () => {
  it('single-sig: sign and verify', () => {
    const key = generateKey('testnet')
    const record = buildRecord({
      pkg: 'my-pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'def',
      maintainerPubs: [key.publicKey],
      threshold: 1
    })

    const pending = createPendingRelease(record, 'testnet')
    const signed = addSignature(pending, key.publicKey, key.privateKey)

    const { valid, required, meetsThreshold } = verifyRecord(signed.record)
    expect(valid).toBe(1)
    expect(required).toBe(1)
    expect(meetsThreshold).toBe(true)
  })

  it('2-of-3 multi-sig: meet threshold after two signatures', () => {
    const key1 = generateKey('testnet')
    const key2 = generateKey('testnet')
    const key3 = generateKey('testnet')

    const record = buildRecord({
      pkg: 'multi-pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'def',
      maintainerPubs: [key1.publicKey, key2.publicKey, key3.publicKey],
      threshold: 2
    })

    let pending = createPendingRelease(record, 'testnet')

    // First signature
    pending = addSignature(pending, key1.publicKey, key1.privateKey)
    const r1 = verifyRecord(pending.record)
    expect(r1.valid).toBe(1)
    expect(r1.meetsThreshold).toBe(false)

    // Second signature
    pending = addSignature(pending, key2.publicKey, key2.privateKey)
    const r2 = verifyRecord(pending.record)
    expect(r2.valid).toBe(2)
    expect(r2.meetsThreshold).toBe(true)
  })

  it('throws if the same key signs twice', () => {
    const key = generateKey('testnet')
    const record = buildRecord({
      pkg: 'pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'def',
      maintainerPubs: [key.publicKey],
      threshold: 1
    })

    let pending = createPendingRelease(record, 'testnet')
    pending = addSignature(pending, key.publicKey, key.privateKey)

    expect(() => addSignature(pending, key.publicKey, key.privateKey)).toThrow()
  })

  it('throws if the key is not a registered maintainer', () => {
    const key1 = generateKey('testnet')
    const key2 = generateKey('testnet')

    const record = buildRecord({
      pkg: 'pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'def',
      maintainerPubs: [key1.publicKey],
      threshold: 1
    })

    const pending = createPendingRelease(record, 'testnet')
    expect(() => addSignature(pending, key2.publicKey, key2.privateKey)).toThrow()
  })

  it('signature verification fails with a tampered record', () => {
    const key = generateKey('testnet')
    const record = buildRecord({
      pkg: 'pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc',
      art: 'legitimate-hash',
      maintainerPubs: [key.publicKey],
      threshold: 1
    })

    let pending = createPendingRelease(record, 'testnet')
    pending = addSignature(pending, key.publicKey, key.privateKey)

    // Tamper with the artifact hash after signing
    const tampered = {
      ...pending.record,
      art: 'malicious-hash'
    }

    const { valid, meetsThreshold } = verifyRecord(tampered)
    expect(valid).toBe(0)
    expect(meetsThreshold).toBe(false)
  })
})

describe('diffHash', () => {
  it('produces a 64-char hex string', () => {
    const h = diffHash('a'.repeat(64), 'b'.repeat(64))
    expect(h).toHaveLength(64)
  })

  it('is deterministic', () => {
    const h1 = diffHash('prev', 'next')
    const h2 = diffHash('prev', 'next')
    expect(h1).toBe(h2)
  })

  it('changes when inputs change', () => {
    expect(diffHash('prev', 'v1')).not.toBe(diffHash('prev', 'v2'))
  })
})
