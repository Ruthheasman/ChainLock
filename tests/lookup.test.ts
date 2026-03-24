import { extractOpReturnData } from '../src/chain/lookup'
import { buildOpReturnScript } from '../src/bsv/transaction'
import { encodeRecord } from '../src/bsv/record'
import { buildRecord } from '../src/bsv/record'

describe('extractOpReturnData', () => {
  it('returns null for non-OP_RETURN scripts', () => {
    // A P2PKH locking script starts with OP_DUP (0x76)
    const p2pkh = '76a914' + '0'.repeat(40) + '88ac'
    expect(extractOpReturnData(p2pkh)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(extractOpReturnData('')).toBeNull()
  })

  it('extracts data from a minimal OP_FALSE OP_RETURN script', () => {
    // OP_FALSE (00) OP_RETURN (6a) OP_PUSHDATA(5) "hello"
    const data = Buffer.from('hello')
    const lenByte = data.length.toString(16).padStart(2, '0')
    const scriptHex = '00' + '6a' + lenByte + data.toString('hex')
    const result = extractOpReturnData(scriptHex)
    expect(result).not.toBeNull()
    expect(result?.toString()).toBe('hello')
  })

  it('extracts data from OP_RETURN (without OP_FALSE) scripts', () => {
    // Some miners use OP_RETURN directly without OP_FALSE
    const data = Buffer.from('test data')
    const lenByte = data.length.toString(16).padStart(2, '0')
    const scriptHex = '6a' + lenByte + data.toString('hex')
    const result = extractOpReturnData(scriptHex)
    expect(result).not.toBeNull()
    expect(result?.toString()).toBe('test data')
  })
})

describe('OP_RETURN roundtrip', () => {
  it('encodes a record into an OP_RETURN script and extracts it back', () => {
    const record = buildRecord({
      pkg: 'roundtrip-test',
      ver: '1.0.0',
      reg: 'npm',
      src: 'abcdef',
      art: '0'.repeat(64),
      maintainerPubs: ['03' + '1'.repeat(64)],
      threshold: 1
    })

    const encoded = encodeRecord(record)
    const script = buildOpReturnScript(encoded)
    const scriptHex = script.toHex()

    const extracted = extractOpReturnData(scriptHex)
    expect(extracted).not.toBeNull()
    expect(extracted?.toString('utf8')).toContain('CHAINLOCK_V1:')
    expect(extracted?.toString('utf8')).toContain('roundtrip-test')
  })
})
