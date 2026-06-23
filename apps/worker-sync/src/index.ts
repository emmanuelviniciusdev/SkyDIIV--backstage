import { workflowsFetch } from "./workflows"
import { createLogger } from "./lib/logger"

type Env = Record<string, string | undefined>

/**
 * Cloudflare Worker entry point — worker-sync.
 *
 * A generic host for SkyDIIV data-synchronization Upstash Workflows. Copies
 * all Worker bindings into process.env so downstream modules that read
 * process.env work without modification, then delegates to the @upstash/workflow
 * serveMany router.
 *
 * GET / → health-check (useful for uptime monitors).
 * All other paths → serveMany, which dispatches by the last path segment:
 *   POST /sync/language → sync-language workflow
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
      const response = await workflowsFetch(request, env)
      log.info("Request handled", { path: pathname, status: response.status })
      return response
    } catch (err) {
      log.error("Unhandled error", { path: pathname, error: String(err) })
      throw err
    }
  },
}
