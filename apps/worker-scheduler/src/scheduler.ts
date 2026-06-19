import { getQStashReceiver } from "./lib/qstash"
import { getFlowsForDay } from "./flows/registry"
import type { FlowRunResult, Weekday } from "./flows/types"
import { createLogger } from "./lib/logger"

/**
 * Central schedule handler — invoked via signed POST to a weekday endpoint.
 *
 * Each weekday endpoint (/schedule/every-monday … /schedule/every-sunday) maps
 * to a `Weekday` and funnels through here.
 *
 * Steps:
 *   1. Verify the incoming request is signed by QStash (prevents unauthorised triggers).
 *   2. Resolve all flows registered for the given day.
 *   3. Run them in parallel — one flow failing never stops the others.
 *   4. Return the per-flow results. HTTP status reflects the aggregate outcome:
 *        200  — all flows succeeded (or no flows configured)
 *        207  — partial: some flows failed, some succeeded
 *        500  — all registered flows failed
 */
export async function handleSchedule(request: Request, day: Weekday): Promise<Response> {
  const log = createLogger("scheduler")

  // ── Step 1: Verify QStash signature ────────────────────────────────────────
  const signature = request.headers.get("upstash-signature")
  if (!signature) {
    log.warn("Missing upstash-signature header — rejecting request", { day })
    return new Response("Unauthorized", { status: 401 })
  }

  const body = await request.text()

  try {
    const receiver = getQStashReceiver()
    const isValid = await receiver.verify({ signature, body, url: request.url })

    if (!isValid) {
      log.warn("Invalid QStash signature — rejecting request", { day })
      return new Response("Unauthorized", { status: 401 })
    }
  } catch (err) {
    log.error("Signature verification failed", { day, error: String(err) })
    return new Response("Unauthorized", { status: 401 })
  }

  log.info("QStash signature verified — resolving flows", { day })

  // ── Step 2: Resolve flows ───────────────────────────────────────────────────
  const flows = getFlowsForDay(day)

  if (flows.length === 0) {
    log.info("No flows configured for day — nothing to run", { day })
    return Response.json({ day, flows: [] })
  }

  log.info("Running flows", { day, count: flows.length, names: flows.map((f) => f.name) })

  // ── Step 3: Run all flows in parallel, capturing individual errors ──────────
  const results: FlowRunResult[] = await Promise.all(
    flows.map(async (flow): Promise<FlowRunResult> => {
      try {
        const result = await flow.run()
        log.info("Flow run complete", { day, flow: flow.name })
        return { status: "ok", ...result }
      } catch (err) {
        const error = String(err)
        log.error("Flow run failed", { day, flow: flow.name, error })
        return { flow: flow.name, status: "error", error }
      }
    }),
  )

  // ── Step 4: Determine aggregate HTTP status and respond ─────────────────────
  const failed = results.filter((r) => r.status === "error").length
  const succeeded = results.length - failed

  const httpStatus = failed === 0 ? 200 : succeeded === 0 ? 500 : 207

  log.info("Schedule run complete", { day, succeeded, failed, httpStatus })

  return Response.json({ day, flows: results }, { status: httpStatus })
}
