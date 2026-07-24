import { dispatch } from "../../../lib/dispatcher"
import type { OutboxEventRow } from "../../../lib/db/outbox-events.repository"
import { createLogger } from "../../../lib/logger"
import type { DispatchOutboxEventResult } from "../types"

export async function dispatchOutboxEventStep(event: OutboxEventRow): Promise<DispatchOutboxEventResult> {
  const log = createLogger("dispatch-event")
  log.info("Step started", {
    outboxEventId: event.id,
    eventId: event.event_id,
    eventName: event.event_name,
  })

  try {
    await dispatch(event)
    log.info("Step completed", { outboxEventId: event.id })
    return { ok: true }
  } catch (err) {
    const error = String(err)
    log.error("Step failed", {
      outboxEventId: event.id,
      eventId: event.event_id,
      eventName: event.event_name,
      error,
    })
    return { ok: false, error }
  }
}
