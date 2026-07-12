import { getDb } from "../lib/db/client"
import { SqlOutboxEventsRepository } from "../lib/db/outbox-events.repository"
import type { StaleOutboxEvent } from "../lib/db/outbox-events.repository"
import { getQStashClient } from "../lib/qstash"
import { createLogger } from "../lib/logger"
import { resolveProcessOutboxEventUrl } from "../lib/worker-outbox-events-url"
import type { FlowResult, ScheduleFlow } from "./types"

/** Maximum number of messages in a single QStash batch call. */
const BATCH_SIZE = 100

export interface ProcessOutboxEventPayload {
  outboxEventId: string
}

/**
 * Publishes one QStash message per stale outbox event to worker-outbox-events
 * ({WORKER_OUTBOX_EVENTS_URL}/process-outbox-event), batching in groups of
 * BATCH_SIZE (QStash limit: 100/call).
 *
 * Returns the total number of messages dispatched.
 */
export async function dispatchStaleOutboxEvents(events: StaleOutboxEvent[]): Promise<number> {
  if (events.length === 0) return 0

  const workerUrl = resolveProcessOutboxEventUrl()

  const client = getQStashClient()
  let dispatched = 0

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    const messages = batch.map((event) => ({
      url: workerUrl,
      body: { outboxEventId: event.outboxEventId } satisfies ProcessOutboxEventPayload,
      headers: { "Content-Type": "application/json" },
    }))

    await client.batchJSON(messages)
    dispatched += batch.length
  }

  return dispatched
}

/**
 * Catch-up outbox events flow.
 *
 * 1. Query outbox_events for PENDING rows older than OUTBOX_CATCHUP_MIN_AGE_MINUTES
 *    (invalid or unset values fall back to the default).
 * 2. Batch-publish { outboxEventId } to worker-outbox-events via QStash and return
 *    { flow, dispatched }.
 */
export const catchUpOutboxEventsFlow: ScheduleFlow = {
  name: "catch-up-outbox-events",

  async run(): Promise<FlowResult> {
    const log = createLogger("catch-up-outbox-events-flow")

    const db = getDb()
    const repo = new SqlOutboxEventsRepository(db)
    const { minAgeMinutes, events } = await repo.findStalePendingEvents()
    log.info("Stale outbox events fetched", { minAgeMinutes, count: events.length })

    const dispatched = await dispatchStaleOutboxEvents(events)
    log.info("Catch-up dispatch complete", { dispatched })

    return { flow: this.name, dispatched }
  },
}
