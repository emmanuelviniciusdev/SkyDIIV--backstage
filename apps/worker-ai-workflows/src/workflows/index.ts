import { serveMany } from "@upstash/workflow/cloudflare"
import { generateWeeklyOutfitsWorkflow } from "./generate-weekly-outfits/workflow"

/**
 * Workflow registry for the worker-ai-workflows worker.
 *
 * `serveMany` hosts multiple Upstash Workflows on a single Cloudflare Worker and
 * routes each request by the LAST path segment of its URL. The map key becomes
 * the public endpoint and is preserved across QStash step callbacks:
 *
 *   key "generate-weekly-outfits"  →  POST /generate-weekly-outfits
 *
 * To add a new AI workflow: implement it with `createWorkflow(...)` under
 * src/workflows/<name>/ and register it here under its endpoint key. No routing
 * changes are needed in src/index.ts.
 *
 * Note: workflow keys cannot contain "/".
 */
const { fetch: serveManyFetch } = serveMany({
  "generate-weekly-outfits": generateWeeklyOutfitsWorkflow,
})

/**
 * Dispatches a request to the matching workflow. `serveMany` types its handler
 * as `Promise<any>`; we narrow it to `Promise<Response>` for the caller.
 */
export function workflowsFetch(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  return serveManyFetch(request, env) as Promise<Response>
}
