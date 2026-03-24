import { Transaction, P2PKH, Script, LockingScript, PrivateKey, SatoshisPerKilobyte } from '@bsv/sdk'
import { UTXO, Network } from '../types'
import { encodeRecord } from './record'
import { PackageRecord } from '../types'

const DUST_SATOSHIS = 546
const FEE_RATE_SAT_PER_KB = 1  // BSV fees are very low

/**
 * Build the BSV transaction for publishing a ChainLock record.
 *
 * Structure:
 *   Input:  funded UTXO from the publisher's address
 *   Output 0: OP_RETURN <CHAINLOCK_V1:...json...>  (0 satoshis)
 *   Output 1: dust to CHAINLOCK_INDEX_ADDRESS       (546 satoshis, for discoverability)
 *   Output 2: change back to publisher              (remainder)
 *
 * @param record    - Fully signed PackageRecord
 * @param utxos     - UTXOs to fund the transaction
 * @param wif       - Publisher's WIF private key
 * @param network   - Network to use
 * @returns         - Transaction hex string and estimated txid
 */
export async function buildPublishTransaction(
  record: PackageRecord,
  utxos: UTXO[],
  wif: string,
  network: Network
): Promise<{ txHex: string; txid: string }> {
  const privKey = PrivateKey.fromWif(wif)
  const pubKey = privKey.toPublicKey()
  const changeAddress = pubKey.toAddress().toString()

  const indexAddress = getIndexAddress(network)

  // Build OP_RETURN script
  const recordData = encodeRecord(record)
  const opReturnScript = buildOpReturnScript(recordData)

  const tx = new Transaction()

  // Add inputs from UTXOs.
  // The SDK requires sourceTransaction for fee calculation. We construct a
  // minimal synthetic source transaction containing only the output being spent.
  for (const utxo of utxos) {
    const lockingScript = LockingScript.fromHex(utxo.script)

    // Synthetic source tx: only the output at the given index matters for fee calc.
    const sourceTx = new Transaction()
    // Pad with null outputs up to the vout index (SDK internal pattern)
    ;(sourceTx as unknown as { outputs: unknown[] }).outputs = new Array(utxo.vout + 1).fill(null)
    ;(sourceTx as unknown as { outputs: unknown[] }).outputs[utxo.vout] = {
      satoshis: utxo.satoshis,
      lockingScript
    }

    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      sourceTransaction: sourceTx,
      unlockingScriptTemplate: new P2PKH().unlock(privKey)
    })
  }

  // Output 0: OP_RETURN with record data
  tx.addOutput({
    satoshis: 0,
    lockingScript: opReturnScript
  })

  // Output 1: dust to index address (enables WoC address-based discovery)
  if (indexAddress && !indexAddress.includes('111')) {
    tx.addOutput({
      satoshis: DUST_SATOSHIS,
      lockingScript: new P2PKH().lock(indexAddress)
    })
  }

  // Output 2: change back to publisher
  tx.addOutput({
    change: true,
    lockingScript: new P2PKH().lock(changeAddress)
  })

  // Calculate fee and sign
  await tx.fee(new SatoshisPerKilobyte(FEE_RATE_SAT_PER_KB))
  await tx.sign()

  const txHex = tx.toHex()
  const txid = tx.id('hex') as string

  return { txHex, txid }
}

/**
 * Build an OP_RETURN locking script: OP_FALSE OP_RETURN <data>
 */
export function buildOpReturnScript(data: Buffer): Script {
  // OP_FALSE = 0x00, OP_RETURN = 0x6a (106)
  // ScriptChunk requires an `op` field; use OP_PUSHDATA1 (0x4c) for data > 75 bytes,
  // or the push length opcode directly for smaller data.
  const bytes = Array.from(data)
  const pushOp = bytes.length <= 75
    ? bytes.length          // direct push opcode (length byte)
    : bytes.length <= 255
      ? 0x4c                // OP_PUSHDATA1
      : 0x4d               // OP_PUSHDATA2 (for very large payloads)

  const script = new Script([
    { op: 0x00 },           // OP_FALSE
    { op: 0x6a },           // OP_RETURN
    { op: pushOp, data: bytes }
  ])
  return script
}

/**
 * Returns the ChainLock index address for the given network.
 * This is a well-known address used to index all ChainLock records.
 * In production these would be real funded addresses controlled by the project.
 */
function getIndexAddress(network: Network): string {
  // These are placeholder index addresses. In production, a real address per network
  // would be established by the ChainLock project for discoverability.
  return network === 'mainnet'
    ? '1ChainLockIndexMainnet11111111111'  // replace with real address
    : 'mChainLockIndexTestnet111111111111' // replace with real address
}

/**
 * Estimate whether the given UTXOs have enough funds to cover a publish tx.
 * Returns { sufficient: boolean, estimatedFee: number, totalInput: number }
 */
export function estimateFunds(utxos: UTXO[]): {
  sufficient: boolean
  estimatedFee: number
  totalInput: number
} {
  const totalInput = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  // Rough estimate: ~400 bytes * 1 sat/byte = 400 sats, plus dust output
  const estimatedFee = 400 + DUST_SATOSHIS
  return {
    sufficient: totalInput >= estimatedFee,
    estimatedFee,
    totalInput
  }
}
