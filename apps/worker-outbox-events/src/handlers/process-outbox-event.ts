import { z } from "zod"
import { getQStashReceiver } from "../lib/qstash"
import { getDb } from "../lib/db/client"
import { SqlOutboxEventsRepository } from "../lib/db/outbox-events.repository"
import { dispatch } from "../lib/dispatcher"
import {
  tryAcquireOutboxProcessingLock,
  releaseOutboxProcessingLock,
} from "../lib/cache/outbox-processing-cache"
import { createLogger } from "../lib/logger"

export type ProcessOutboxEventPayload = {
  outboxEventId: string
}

const ProcessOutboxEventPayloadSchema = z.object({
  outboxEventId: z.string().min(1),
})

/**
 * Handles `POST /process-outbox-event`.
 *
 * Steps:
 *   1. Validate the request — verify the QStash signature and parse the `{ outboxEventId }`
 *      body. Rejects unsigned/invalid requests before any side effects.
 *   2. Try to acquire the Redis processing lock atomically (SET NX EX) — if the lock is
 *      already held by a concurrent invocation, skip and return 200 (prevents duplicate
 *      dispatches). Lock TTL acts as a safety net if the worker crashes.
 *   3. Fetch and dispatch — read the outbox event row from the database and forward its
 *      payload to the appropriate downstream worker via QStash.
 *      - Row not found: release lock, return 200 (idempotency — already processed).
 *      - Dispatch error: release lock, return 500 so QStash retries.
 *   4. Finalize: delete the outbox event record and release the processing lock.
 *      - Delete failure is logged but does not fail the request — dispatch already succeeded.
 */
export async function handleProcessOutboxEvent(request: Request): Promise<Response> {
  const log = createLogger("process-outbox-event")

  // ── Step 1: Validate request — verify signature and parse payload ────────────
  const signature = request.headers.get("upstash-signature")
  if (!signature) {
    log.warn("Missing upstash-signature header — rejecting request")
    return new Response("Unauthorized", { status: 401 })
  }

  const body = await request.text()

  try {
    const receiver = getQStashReceiver()
    const isValid = await receiver.verify({ signature, body, url: request.url })
    if (!isValid) {
      log.warn("Invalid QStash signature — rejecting request")
      return new Response("Unauthorized", { status: 401 })
    }
  } catch (err) {
    log.error("Signature verification failed", { error: String(err) })
    return new Response("Unauthorized", { status: 401 })
  }

  let parsed: ProcessOutboxEventPayload
  try {
    const json = JSON.parse(body) as unknown
    parsed = ProcessOutboxEventPayloadSchema.parse(json)
  } catch (err) {
    log.warn("Invalid request payload", { error: String(err) })
    return new Response("Bad Request", { status: 400 })
  }

  const { outboxEventId } = parsed
  log.info("Processing outbox event", { outboxEventId })

  // ── Step 2: Try to acquire processing lock ───────────────────────────────────
  const lockAcquired = await tryAcquireOutboxProcessingLock(outboxEventId)
  if (!lockAcquired) {
    log.warn("Outbox event is already being processed — skipping", { outboxEventId })
    return Response.json({ processed: false, reason: "already-processing", outboxEventId })
  }
  log.info("Processing lock acquired", { outboxEventId })

  // ── Step 3: Fetch and dispatch ────────────────────────────────────────────────
  const db = getDb()
  const repo = new SqlOutboxEventsRepository(db)

  const event = await repo.findById(outboxEventId)
  if (!event) {
    log.warn("Outbox event not found — already processed or never existed", { outboxEventId })
    await releaseOutboxProcessingLock(outboxEventId)
    return Response.json({ processed: false, reason: "not-found", outboxEventId })
  }

  log.info("Outbox event found", { outboxEventId, flow: event.flow, event: event.event })

  try {
    await dispatch(event)
    log.info("Outbox event dispatched", { outboxEventId, flow: event.flow })
  } catch (err) {
    log.error("Failed to dispatch outbox event", {
      outboxEventId,
      flow: event.flow,
      event: event.event,
      error: String(err),
    })
    // Release the lock so QStash retries can acquire it and reprocess.
    await releaseOutboxProcessingLock(outboxEventId)
    return new Response("Internal Server Error", { status: 500 })
  }

  // ── Step 4: Finalize — delete outbox event and release lock ──────────────────
  try {
    await repo.deleteById(outboxEventId)
    log.info("Outbox event deleted", { outboxEventId })
  } catch (err) {
    // Dispatch already succeeded. Log the failure but do not return 5xx — a retry
    // would re-dispatch to the downstream worker, causing duplicate processing.
    log.error("Failed to delete outbox event after successful dispatch", {
      outboxEventId,
      error: String(err),
    })
  }

  await releaseOutboxProcessingLock(outboxEventId)
  log.info("Processing lock released", { outboxEventId })

  return Response.json({
    processed: true,
    outboxEventId,
    flow: event.flow,
    event: event.event,
  })
}
