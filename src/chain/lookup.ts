import axios from 'axios'
import { Network, OnChainRecord, UTXO } from '../types'
import { decodeRecord, CHAINLOCK_OP_RETURN_PREFIX } from '../bsv/record'

const WOC_BASE: Record<Network, string> = {
  mainnet: 'https://api.whatsonchain.com/v1/bsv/main',
  testnet: 'https://api.whatsonchain.com/v1/bsv/test'
}

function wocUrl(network: Network): string {
  return WOC_BASE[network]
}

/**
 * Fetch UTXOs for a given BSV address from WhatsOnChain.
 */
export async function fetchUTXOs(address: string, network: Network): Promise<UTXO[]> {
  const url = `${wocUrl(network)}/address/${address}/unspent`
  const response = await axios.get<WocUTXO[]>(url, { timeout: 15_000 })
  return response.data.map((u) => ({
    txid: u.tx_hash,
    vout: u.tx_pos,
    satoshis: u.value,
    script: ''  // WoC doesn't return the script here; we derive it below
  }))
}

/**
 * Fetch the P2PKH locking script for a given UTXO.
 * Returns the populated UTXOs with script field filled in.
 */
export async function enrichUTXOsWithScripts(
  utxos: UTXO[],
  address: string,
  network: Network
): Promise<UTXO[]> {
  return Promise.all(
    utxos.map(async (utxo) => {
      try {
        const script = await fetchOutputScript(utxo.txid, utxo.vout, network)
        return { ...utxo, script }
      } catch {
        // Fall back to deriving P2PKH from address
        const script = deriveP2PKHScript(address)
        return { ...utxo, script }
      }
    })
  )
}

/**
 * Fetch the hex locking script for a specific tx output from WoC.
 */
export async function fetchOutputScript(
  txid: string,
  vout: number,
  network: Network
): Promise<string> {
  const url = `${wocUrl(network)}/tx/${txid}`
  const response = await axios.get<WocTx>(url, { timeout: 15_000 })
  const output = response.data.vout[vout]
  if (!output) throw new Error(`Output ${vout} not found in tx ${txid}`)
  return output.scriptPubKey.hex
}

/**
 * Fetch all ChainLock records for a specific package from the BSV blockchain.
 *
 * Strategy: query the WoC address history for the ChainLock index address,
 * then scan each transaction's OP_RETURN outputs for matching records.
 */
export async function lookupPackageRecords(
  pkg: string,
  ver: string,
  network: Network
): Promise<OnChainRecord[]> {
  // Query WoC OP_RETURN search endpoint for our prefix
  // WoC supports searching for transactions with specific OP_RETURN data
  const prefixHex = Buffer.from(CHAINLOCK_OP_RETURN_PREFIX + pkg + '@' + ver).toString('hex')
  const results: OnChainRecord[] = []

  try {
    // Try WoC op_return search (not all WoC tiers support this; handle gracefully)
    const url = `${wocUrl(network)}/op_return/${prefixHex}`
    const response = await axios.get<{ txs?: WocOpReturnTx[] }>(url, { timeout: 15_000 })

    if (response.data?.txs) {
      for (const entry of response.data.txs) {
        const record = await fetchRecordFromTx(entry.txid, network)
        if (record && record.pkg === pkg && record.ver === ver) {
          results.push({ txid: entry.txid, record })
        }
      }
    }
  } catch {
    // Fallback: scan address history (less efficient but more compatible)
    const indexAddress = getIndexAddress(network)
    if (!indexAddress.includes('XXXX') && !indexAddress.includes('111')) {
      const txids = await fetchAddressHistory(indexAddress, network)
      for (const txid of txids.slice(0, 50)) {  // limit scan
        try {
          const record = await fetchRecordFromTx(txid, network)
          if (record && record.pkg === pkg && record.ver === ver) {
            results.push({ txid, record })
          }
        } catch {
          // Skip failed tx lookups
        }
      }
    }
  }

  return results
}

/**
 * Extract a ChainLock record from a transaction's OP_RETURN output.
 * Returns null if the transaction has no valid ChainLock record.
 */
export async function fetchRecordFromTx(
  txid: string,
  network: Network
): Promise<import('../types').PackageRecord | null> {
  const url = `${wocUrl(network)}/tx/${txid}`
  const response = await axios.get<WocTx>(url, { timeout: 15_000 })

  for (const out of response.data.vout) {
    if (out.scriptPubKey?.type === 'nulldata' || out.scriptPubKey?.asm?.startsWith('OP_RETURN')) {
      const hex = out.scriptPubKey.hex
      // Strip the OP_FALSE OP_RETURN prefix (first 4 bytes: 00 6a + pushdata)
      const raw = extractOpReturnData(hex)
      if (raw) {
        const record = decodeRecord(raw)
        if (record) return record
      }
    }
  }
  return null
}

/**
 * Fetch transaction history (list of txids) for an address.
 */
async function fetchAddressHistory(address: string, network: Network): Promise<string[]> {
  const url = `${wocUrl(network)}/address/${address}/history`
  const response = await axios.get<WocHistoryEntry[]>(url, { timeout: 15_000 })
  return response.data.map((e) => e.tx_hash)
}

/**
 * Extract raw data bytes from a hex OP_RETURN script.
 * Handles: OP_FALSE OP_RETURN <pushdata> format.
 */
export function extractOpReturnData(scriptHex: string): Buffer | null {
  try {
    const buf = Buffer.from(scriptHex, 'hex')
    let offset = 0

    // Skip OP_FALSE (0x00) if present
    if (buf[offset] === 0x00) offset++
    // Must have OP_RETURN (0x6a)
    if (buf[offset] !== 0x6a) return null
    offset++

    // Next byte is pushdata length or opcode
    if (offset >= buf.length) return null
    const pushByte = buf[offset]

    if (pushByte <= 0x4b) {
      // Single-byte push length
      offset++
      return buf.slice(offset, offset + pushByte)
    } else if (pushByte === 0x4c) {
      // OP_PUSHDATA1: next byte is length
      offset++
      const len = buf[offset]
      offset++
      return buf.slice(offset, offset + len)
    } else if (pushByte === 0x4d) {
      // OP_PUSHDATA2: next 2 bytes are little-endian length
      offset++
      const len = buf.readUInt16LE(offset)
      offset += 2
      return buf.slice(offset, offset + len)
    }

    return null
  } catch {
    return null
  }
}

/**
 * Derive a P2PKH locking script hex from a BSV address (for UTXO enrichment).
 * Returns an empty string if derivation fails.
 */
function deriveP2PKHScript(address: string): string {
  try {
    const { P2PKH } = require('@bsv/sdk')
    const lockScript = new P2PKH().lock(address)
    return lockScript.toHex()
  } catch {
    return ''
  }
}

function getIndexAddress(network: Network): string {
  return network === 'mainnet'
    ? '1ChainLockIndexMainnet11111111111'
    : 'mChainLockIndexTestnet111111111111'
}

// WhatsOnChain API types
interface WocUTXO {
  tx_hash: string
  tx_pos: number
  value: number
  height: number
}

interface WocTx {
  txid: string
  vout: Array<{
    value: number
    n: number
    scriptPubKey: {
      asm: string
      hex: string
      type: string
    }
  }>
  blockheight?: number
}

interface WocHistoryEntry {
  tx_hash: string
  height: number
}

interface WocOpReturnTx {
  txid: string
}
