import { Client } from "@upstash/qstash"

let _client: Client | null = null

export function getQStashClient(): Client {
  if (!_client) {
    const token = process.env.QSTASH_TOKEN
    if (!token) throw new Error("QSTASH_TOKEN environment variable is not set")
    const baseUrl = process.env.QSTASH_URL
    _client = new Client({ token, ...(baseUrl ? { baseUrl } : {}) })
  }
  return _client
}

/** Resets singleton client. Call between requests in tests or when env changes. */
export function resetQStashClient(): void {
  _client = null
}
