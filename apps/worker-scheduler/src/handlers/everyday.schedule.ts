import { getEverydayFlows } from "../flows/everyday-registry"
import type { FlowRunResult } from "../flows/types"
import { createLogger } from "../lib/logger"
import { verifyQStashRequest } from "../lib/verify-qstash-request"

/**
 * Everyday schedule handler — invoked via signed POST to /schedule/everyday.
 *
 * Steps:
 *   1. Verify the incoming request is signed by QStash.
 *   2. Resolve all flows registered in `flows/everyday-registry.ts`.
 *   3. Run them in parallel — one flow failing never stops the others.
 *   4. Return per-flow results. HTTP status reflects the aggregate outcome:
 *        200  — all flows succeeded (or no flows configured)
 *        207  — partial: some flows failed, some succeeded
 *        500  — all registered flows failed
 */
export async function handleEverydaySchedule(request: Request): Promise<Response> {
  const log = createLogger("everyday-schedule")

  const verified = await verifyQStashRequest(request, log)
  if (!verified.ok) return verified.response

  log.info("QStash signature verified — resolving everyday flows")

  const flows = getEverydayFlows()

  if (flows.length === 0) {
    log.info("No everyday flows configured — nothing to run")
    return Response.json({ flows: [] })
  }

  log.info("Running everyday flows", { count: flows.length, names: flows.map((f) => f.name) })

  const results: FlowRunResult[] = await Promise.all(
    flows.map(async (flow): Promise<FlowRunResult> => {
      try {
        const result = await flow.run()
        log.info("Everyday flow run complete", { flow: flow.name })
        return { status: "ok", ...result }
      } catch (err) {
        const error = String(err)
        log.error("Everyday flow run failed", { flow: flow.name, error })
        return { flow: flow.name, status: "error", error }
      }
    }),
  )

  const failed = results.filter((r) => r.status === "error").length
  const succeeded = results.length - failed
  const httpStatus = failed === 0 ? 200 : succeeded === 0 ? 500 : 207

  log.info("Everyday schedule run complete", { succeeded, failed, httpStatus })

  return Response.json({ flows: results }, { status: httpStatus })
}
