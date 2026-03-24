import { sha256, recordHash, hexToBytes, bytesToHex, hexToBuffer, bufferToHex } from '../src/utils/hash'
import { buildRecord } from '../src/bsv/record'

describe('sha256', () => {
  it('produces consistent hex output for string input', () => {
    const hash = sha256('hello')
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(hash).toHaveLength(64)
  })

  it('produces consistent hex output for buffer input', () => {
    const hash = sha256(Buffer.from('hello'))
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('produces different hashes for different inputs', () => {
    expect(sha256('a')).not.toBe(sha256('b'))
  })

  it('handles empty string', () => {
    const hash = sha256('')
    expect(hash).toHaveLength(64)
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('hexToBytes / bytesToHex', () => {
  it('roundtrips correctly', () => {
    const hex = 'deadbeef01234567'
    expect(bytesToHex(hexToBytes(hex))).toBe(hex)
  })

  it('handles empty string', () => {
    expect(hexToBytes('')).toEqual([])
    expect(bytesToHex([])).toBe('')
  })
})

describe('hexToBuffer / bufferToHex', () => {
  it('roundtrips correctly', () => {
    const hex = 'cafebabe'
    expect(bufferToHex(hexToBuffer(hex))).toBe(hex)
  })
})

describe('recordHash', () => {
  it('excludes the sigs field from the hash', () => {
    const record = buildRecord({
      pkg: 'my-pkg',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc123',
      art: 'def456',
      maintainerPubs: ['03' + '0'.repeat(64)],
      threshold: 1
    })

    const hash1 = recordHash(record)

    const recordWithSig = { ...record, sigs: ['somesignature'] }
    const hash2 = recordHash(recordWithSig)

    // The hash must be the same regardless of sigs
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  it('produces different hashes for different records', () => {
    const record1 = buildRecord({
      pkg: 'pkg-a',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc123',
      art: 'def456',
      maintainerPubs: ['03' + '0'.repeat(64)],
      threshold: 1
    })

    const record2 = buildRecord({
      pkg: 'pkg-b',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abc123',
      art: 'def456',
      maintainerPubs: ['03' + '0'.repeat(64)],
      threshold: 1
    })

    expect(recordHash(record1)).not.toBe(recordHash(record2))
  })

  it('is deterministic (same record → same hash)', () => {
    const record = buildRecord({
      pkg: 'my-pkg',
      ver: '2.0.0',
      reg: 'npm',
      src: 'aabbcc',
      art: 'ddeeff',
      maintainerPubs: ['03' + 'a'.repeat(64)],
      threshold: 1
    })
    expect(recordHash(record)).toBe(recordHash(record))
  })
})
