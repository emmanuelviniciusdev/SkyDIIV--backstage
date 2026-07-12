import { dispatch } from "../../../lib/dispatcher"
import type { OutboxEventRow } from "../../../lib/db/outbox-events.repository"
import { createLogger } from "../../../lib/logger"
import type { DispatchOutboxEventResult } from "../types"

export async function dispatchOutboxEventStep(event: OutboxEventRow): Promise<DispatchOutboxEventResult> {
  const log = createLogger("dispatch-event")
  log.info("Step started", { outboxEventId: event.id, flow: event.flow, event: event.event })

  try {
    await dispatch(event)
    log.info("Step completed", { outboxEventId: event.id })
    return { ok: true }
  } catch (err) {
    const error = String(err)
    log.error("Step failed", { outboxEventId: event.id, flow: event.flow, event: event.event, error })
    return { ok: false, error }
  }
}
