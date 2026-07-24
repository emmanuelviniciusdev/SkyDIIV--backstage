import { createWorkflow } from "@upstash/workflow/cloudflare"
import { resetDbClient } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"
import { acquireOutboxProcessingLockStep } from "./steps/acquire-lock"
import { loadOutboxEventStep } from "./steps/load-event"
import { dispatchOutboxEventStep } from "./steps/dispatch-event"
import { markOutboxEventSuccessStep } from "./steps/mark-success"
import { markOutboxEventErrorStep } from "./steps/mark-error"
import { releaseOutboxProcessingLockStep } from "./steps/release-lock"
import {
  processOutboxEventPayloadSchema,
  type ProcessOutboxEventPayload,
  type ProcessOutboxEventResult,
} from "./types"

export type { ProcessOutboxEventPayload } from "./types"

/**
 * process-outbox-event — Upstash Workflow (Cloudflare Workers)
 *
 * Durable steps keep dispatch, status updates, and lock release isolated so a
 * retry after a successful dispatch only re-executes the failing persistence step.
 *
 *   1. acquire-lock   — Redis SET NX EX mutex
 *   2. load-event     — SELECT outbox_events; skip if not PENDING
 *   3. dispatch-event — publish payload to downstream worker (side effect)
 *   4. mark-success / mark-error — UPDATE outbox_events.status
 *   5. release-lock   — DEL outbox-processing:{id}
 */
export const processOutboxEventWorkflow = createWorkflow<
  ProcessOutboxEventPayload,
  ProcessOutboxEventResult
>(async (context) => {
  const parsed = processOutboxEventPayloadSchema.safeParse(context.requestPayload)
  const log = createLogger("process-outbox-event")

  if (!parsed.success) {
    log.error("Invalid workflow payload", { issues: parsed.error.issues })
    throw new Error("Workflow payload must include a non-empty outboxEventId")
  }

  const { outboxEventId } = parsed.data
  log.info("Workflow started", { outboxEventId })

  resetDbClient()
  log.debug("DB client reset", { outboxEventId })

  log.info("Starting step: acquire-lock", { outboxEventId })
  const lockAcquired = await context.run("acquire-lock", async () => {
    return acquireOutboxProcessingLockStep(outboxEventId)
  })
  log.info("Step completed: acquire-lock", { outboxEventId, lockAcquired })

  if (!lockAcquired) {
    log.warn("Outbox event is already being processed — skipping", { outboxEventId })
    return { processed: false, reason: "already-processing", outboxEventId }
  }

  log.info("Starting step: load-event", { outboxEventId })
  const loadResult = await context.run("load-event", async () => {
    return loadOutboxEventStep(outboxEventId)
  })
  log.info("Step completed: load-event", { outboxEventId, kind: loadResult.kind })

  if (loadResult.kind === "skip") {
    log.info("Starting step: release-lock", { outboxEventId })
    await context.run("release-lock", async () => {
      return releaseOutboxProcessingLockStep(outboxEventId)
    })
    log.info("Step completed: release-lock", { outboxEventId })

    if (loadResult.reason === "not-found") {
      return { processed: false, reason: "not-found", outboxEventId }
    }

    return {
      processed: false,
      reason: "already-processed",
      outboxEventId,
      status: loadResult.status,
    }
  }

  const event = loadResult.event

  log.info("Starting step: dispatch-event", { outboxEventId })
  const dispatchResult = await context.run("dispatch-event", async () => {
    return dispatchOutboxEventStep(event)
  })
  log.info("Step completed: dispatch-event", { outboxEventId, ok: dispatchResult.ok })

  if (!dispatchResult.ok) {
    log.info("Starting step: mark-error", { outboxEventId })
    await context.run("mark-error", async () => {
      return markOutboxEventErrorStep(outboxEventId)
    })
    log.info("Step completed: mark-error", { outboxEventId })

    log.info("Starting step: release-lock", { outboxEventId })
    await context.run("release-lock", async () => {
      return releaseOutboxProcessingLockStep(outboxEventId)
    })
    log.info("Step completed: release-lock", { outboxEventId })

    throw new Error(`Failed to dispatch outbox event: ${dispatchResult.error}`)
  }

  log.info("Starting step: mark-success", { outboxEventId })
  await context.run("mark-success", async () => {
    return markOutboxEventSuccessStep(outboxEventId)
  })
  log.info("Step completed: mark-success", { outboxEventId })

  log.info("Starting step: release-lock", { outboxEventId })
  await context.run("release-lock", async () => {
    return releaseOutboxProcessingLockStep(outboxEventId)
  })
  log.info("Step completed: release-lock", { outboxEventId })

  const result: ProcessOutboxEventResult = {
    processed: true,
    outboxEventId,
    eventId: event.event_id,
    eventName: event.event_name,
  }

  log.info("Workflow completed", result)
  return result
})
