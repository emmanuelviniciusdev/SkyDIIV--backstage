import { getDb } from "../../../lib/db/client"
import { SqlOutboxEventsRepository } from "../../../lib/db/outbox-events.repository"
import { createLogger } from "../../../lib/logger"
import type { LoadOutboxEventResult } from "../types"

export async function loadOutboxEventStep(outboxEventId: string): Promise<LoadOutboxEventResult> {
  const log = createLogger("load-event")
  log.info("Step started", { outboxEventId })

  const db = getDb()
  const repo = new SqlOutboxEventsRepository(db)
  const event = await repo.findById(outboxEventId)

  if (!event) {
    log.warn("Outbox event not found — never existed", { outboxEventId })
    return { kind: "skip", reason: "not-found" }
  }

  if (event.status !== "PENDING") {
    log.warn("Outbox event already processed — skipping", { outboxEventId, status: event.status })
    return { kind: "skip", reason: "already-processed", status: event.status }
  }

  log.info("Step completed", { outboxEventId, flow: event.flow, event: event.event })
  return { kind: "ready", event }
}
