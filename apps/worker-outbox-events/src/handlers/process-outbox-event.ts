import { z } from "zod"
import { getQStashReceiver } from "../lib/qstash"
import { getDb } from "../lib/db/client"
import { SqlOutboxEventsRepository } from "../lib/db/outbox-events.repository"
import { dispatch } from "../lib/dispatcher"
import {
  isOutboxEventBeingProcessed,
  acquireOutboxProcessingLock,
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
 *   1. Verify the incoming request is signed by QStash (prevents unauthorised triggers).
 *   2. Parse and validate the `{ outboxEventId }` body.
 *   3. Check the Redis processing lock — if the event is already being processed by a
 *      concurrent invocation, skip and return 200 (prevents duplicate dispatches).
 *   4. Acquire the Redis processing lock for this event.
 *   5. Fetch the outbox event from the database by ID.
 *      - If not found, release the lock and return 200 (idempotency — already processed).
 *   6. Dispatch the event payload to the appropriate downstream worker via QStash.
 *      - On failure, release the lock and return 500 so QStash retries.
 *   7. Delete the outbox event record from the database.
 *      - Delete failure is logged but does not fail the request — dispatch already succeeded.
 *   8. Release the Redis processing lock (successful processing complete).
 */
export async function handleProcessOutboxEvent(request: Request): Promise<Response> {
  const log = createLogger("process-outbox-event")

  // ── Step 1: Verify QStash signature ──────────────────────────────────────────
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

  // ── Step 2: Parse payload ─────────────────────────────────────────────────────
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

  // ── Step 3: Check processing lock ────────────────────────────────────────────
  const alreadyProcessing = await isOutboxEventBeingProcessed(outboxEventId)
  if (alreadyProcessing) {
    log.warn("Outbox event is already being processed — skipping", { outboxEventId })
    return Response.json({ processed: false, reason: "already-processing", outboxEventId })
  }

  // ── Step 4: Acquire processing lock ──────────────────────────────────────────
  await acquireOutboxProcessingLock(outboxEventId)
  log.info("Processing lock acquired", { outboxEventId })

  // ── Step 5: Fetch outbox event ────────────────────────────────────────────────
  const db = getDb()
  const repo = new SqlOutboxEventsRepository(db)

  const event = await repo.findById(outboxEventId)
  if (!event) {
    log.warn("Outbox event not found — already processed or never existed", { outboxEventId })
    await releaseOutboxProcessingLock(outboxEventId)
    return Response.json({ processed: false, reason: "not-found", outboxEventId })
  }

  log.info("Outbox event found", { outboxEventId, flow: event.flow, event: event.event })

  // ── Step 6: Dispatch to downstream worker ─────────────────────────────────────
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

  // ── Step 7: Delete outbox event ───────────────────────────────────────────────
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

  // ── Step 8: Release processing lock ──────────────────────────────────────────
  await releaseOutboxProcessingLock(outboxEventId)
  log.info("Processing lock released", { outboxEventId })

  return Response.json({
    processed: true,
    outboxEventId,
    flow: event.flow,
    event: event.event,
  })
}
