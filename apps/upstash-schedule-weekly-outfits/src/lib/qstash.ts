import { Client, Receiver } from "@upstash/qstash"
import type { EligibleUser } from "./db/users.repository"

/** Maximum number of messages in a single QStash batch call. */
const BATCH_SIZE = 100

export interface GenerateWeeklyOutfitsPayload {
  userId: string
}

let _client: Client | null = null
let _receiver: Receiver | null = null

export function getQStashClient(): Client {
  if (!_client) {
    const token = process.env.QSTASH_TOKEN
    if (!token) throw new Error("QSTASH_TOKEN environment variable is not set")
    _client = new Client({ token })
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

/**
 * Publishes one QStash message per eligible user to the weekly-outfits worker
 * URL, batching requests in groups of BATCH_SIZE (QStash limit: 100/call).
 *
 * Returns the total number of messages dispatched.
 */
export async function dispatchUsersToWorkflow(users: EligibleUser[]): Promise<number> {
  if (users.length === 0) return 0

  const workerUrl = process.env.WEEKLY_OUTFITS_WORKER_URL
  if (!workerUrl) throw new Error("WEEKLY_OUTFITS_WORKER_URL environment variable is not set")

  const client = getQStashClient()
  let dispatched = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    const messages = batch.map((user) => ({
      url: workerUrl,
      body: JSON.stringify({ userId: user.userId } satisfies GenerateWeeklyOutfitsPayload),
      headers: { "Content-Type": "application/json" },
    }))

    await client.batchJSON(messages)
    dispatched += batch.length
  }

  return dispatched
}
