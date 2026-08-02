import { getQStashClient } from "../qstash"

/**
 * Resolves the worker-outbox-events process-outbox-event URL.
 * WORKER_OUTBOX_EVENTS_URL must be the worker origin (no path).
 */
export function resolveProcessOutboxEventUrl(): string {
  const base = process.env.WORKER_OUTBOX_EVENTS_URL?.trim()
  if (!base) {
    throw new Error("WORKER_OUTBOX_EVENTS_URL environment variable is not set")
  }
  return new URL("/process-outbox-event", base).toString()
}

/**
 * Batch-publishes outbox event IDs to QStash → worker-outbox-events.
 * Uses QStash batchJSON even for a single id (consistent with web outbox helpers).
 */
export async function batchPublishOutboxMessages(outboxEventIds: string[]): Promise<void> {
  if (outboxEventIds.length === 0) return

  const client = getQStashClient()
  const url = resolveProcessOutboxEventUrl()
  await client.batchJSON(
    outboxEventIds.map((outboxEventId) => ({
      url,
      body: { outboxEventId },
    })),
  )
}
