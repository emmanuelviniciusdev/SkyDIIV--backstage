import { catchUpOutboxEventsFlow } from "../flows/catch-up-outbox-events.flow"
import { createLogger } from "../lib/logger"
import { verifyQStashRequest } from "../lib/verify-qstash-request"

/**
 * Handles `POST /schedule/catch-up-outbox-events`.
 *
 * Steps:
 *   1. Verify the incoming request is signed by QStash.
 *   2. Run the catch-up-outbox-events flow and return its result (or 500 on failure).
 */
export async function handleCatchUpOutboxEventsSchedule(request: Request): Promise<Response> {
  const log = createLogger("catch-up-outbox-events-schedule")

  const verified = await verifyQStashRequest(request, log)
  if (!verified.ok) return verified.response

  log.info("QStash signature verified — running catch-up-outbox-events flow")

  try {
    const result = await catchUpOutboxEventsFlow.run()
    log.info("Catch-up flow complete", result)
    return Response.json({ status: "ok", ...result })
  } catch (err) {
    const error = String(err)
    log.error("Catch-up flow failed", { error })
    return Response.json(
      { flow: catchUpOutboxEventsFlow.name, status: "error", error },
      { status: 500 },
    )
  }
}
