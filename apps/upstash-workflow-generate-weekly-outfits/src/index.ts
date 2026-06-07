import { workflowFetch } from "./workflow"
import { createLogger } from "./lib/logger"

type Env = Record<string, string | undefined>

/**
 * Cloudflare Worker entry point — GenerateWeeklyOutfits workflow.
 *
 * Copies all Worker bindings into process.env so downstream modules that
 * read process.env work without modification, then delegates to the
 * @upstash/workflow cloudflare adapter.
 *
 * GET / → health-check (useful for uptime monitors).
 * All other paths → Upstash Workflow handler.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    Object.assign(process.env, env)

    const { method, url } = request
    const { pathname } = new URL(url)
    const log = createLogger("worker")

    log.info("Request received", { method, path: pathname })

    if (method === "GET" && pathname === "/") {
      const body = { status: "ok", timestamp: new Date().toISOString() }
      log.info("Health check", body)
      return Response.json(body)
    }

    try {
      const response = await workflowFetch(request, env)
      log.info("Request handled", { path: pathname, status: response.status })
      return response
    } catch (err) {
      log.error("Unhandled error", { path: pathname, error: String(err) })
      throw err
    }
  },
}
