import axios from 'axios'
import { Network } from '../types'

const WOC_BROADCAST_URL: Record<Network, string> = {
  mainnet: 'https://api.whatsonchain.com/v1/bsv/main/tx/raw',
  testnet: 'https://api.whatsonchain.com/v1/bsv/test/tx/raw'
}

/**
 * Broadcast a raw transaction hex to the BSV network via WhatsOnChain.
 * Returns the txid on success, throws on failure.
 */
export async function broadcastTransaction(txHex: string, network: Network): Promise<string> {
  const url = WOC_BROADCAST_URL[network]

  const response = await axios.post<string>(
    url,
    { txhex: txHex },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30_000
    }
  )

  // WoC returns the txid as a plain string
  const txid = typeof response.data === 'string'
    ? response.data.trim().replace(/^"/, '').replace(/"$/, '')
    : String(response.data)

  if (!txid || txid.length !== 64) {
    throw new Error(`Unexpected broadcast response: ${JSON.stringify(response.data)}`)
  }

  return txid
}

/**
 * Broadcast via TAAL's ARC endpoint.
 * Requires an API key. Used as an alternative broadcaster.
 */
export async function broadcastViaARC(
  txHex: string,
  network: Network,
  apiKey?: string
): Promise<string> {
  const baseUrl = network === 'mainnet'
    ? 'https://arc.taal.com'
    : 'https://arc-test.taal.com'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const response = await axios.post<ARCResponse>(
    `${baseUrl}/v1/tx`,
    { rawTx: txHex },
    { headers, timeout: 30_000 }
  )

  const { txid, txStatus } = response.data

  if (!txid) {
    throw new Error(`ARC broadcast failed: ${JSON.stringify(response.data)}`)
  }

  // txStatus can be SEEN_ON_NETWORK, MINED, etc.
  if (txStatus === 'ERROR') {
    throw new Error(`ARC rejected transaction: ${JSON.stringify(response.data)}`)
  }

  return txid
}

interface ARCResponse {
  txid?: string
  txStatus?: string
  extraInfo?: string
}
