import { handleSchedule } from "./scheduler"
import { createLogger } from "./lib/logger"

type Env = Record<string, string | undefined>

/**
 * Cloudflare Worker entry point — WeeklyOutfits Scheduler.
 *
 * Copies all Worker bindings into process.env so downstream modules that
 * read process.env work without modification.
 *
 * GET /          → health-check (useful for uptime monitors).
 * POST /schedule → QStash CRON endpoint; triggers the weekly dispatch.
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

    if (method === "POST" && pathname === "/schedule") {
      return handleSchedule(request)
    }

    log.warn("Route not found", { method, path: pathname })
    return new Response("Not Found", { status: 404 })
  },
}
