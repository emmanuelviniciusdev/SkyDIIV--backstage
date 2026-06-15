import { Client, Receiver } from "@upstash/qstash"

let _client: Client | null = null
let _receiver: Receiver | null = null

export function getQStashClient(): Client {
  if (!_client) {
    const token = process.env.QSTASH_TOKEN
    if (!token) throw new Error("QSTASH_TOKEN environment variable is not set")
    const baseUrl = process.env.QSTASH_URL
    _client = new Client({ token, ...(baseUrl ? { baseUrl } : {}) })
  }
  return _client
}

export function getQStashReceiver(): Receiver {
  if (!_receiver) {
    const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY
    const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY
    if (!currentKey) throw new Error("QSTASH_CURRENT_SIGNING_KEY environment variable is not set")
    if (!nextKey) throw new Error("QSTASH_NEXT_SIGNING_KEY environment variable is not set")
    _receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey })
  }
  return _receiver
}

/** Resets singleton clients. Call between requests in tests or when env changes. */
export function resetQStashClients(): void {
  _client = null
  _receiver = null
}
