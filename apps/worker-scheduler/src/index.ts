import { handleCatchUpOutboxEventsSchedule } from "./handlers/catch-up-outbox-events.schedule"
import { resetDbClient } from "./lib/db/client"
import { handleSchedule } from "./scheduler"
import { createLogger } from "./lib/logger"
import type { Weekday } from "./flows/types"

type Env = Record<string, string | undefined>

const CATCH_UP_OUTBOX_EVENTS_PATH = "/schedule/catch-up-outbox-events"

/**
 * Maps each weekday endpoint to its `Weekday`. Adding a new scheduled job does
 * not require touching this map — register the flow in `flows/registry.ts`.
 */
const DAY_ROUTES: Readonly<Record<string, Weekday>> = {
  "/schedule/every-monday": "monday",
  "/schedule/every-tuesday": "tuesday",
  "/schedule/every-wednesday": "wednesday",
  "/schedule/every-thursday": "thursday",
  "/schedule/every-friday": "friday",
  "/schedule/every-saturday": "saturday",
  "/schedule/every-sunday": "sunday",
}

/**
 * Cloudflare Worker entry point — central scheduler.
 *
 * Copies all Worker bindings into process.env so downstream modules that
 * read process.env work without modification.
 *
 * GET  /                                  → health-check (useful for uptime monitors).
 * POST /schedule/every-<day>              → signed trigger endpoint; runs the day's flows.
 * POST /schedule/catch-up-outbox-events   → signed trigger; re-enqueues stale outbox events.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    Object.assign(process.env, env)
    // CF Workers isolates are reused across requests; drop any postgres.js
    // connection from a prior request so I/O stays scoped to this handler.
    resetDbClient()

    const { method, url } = request
    const { pathname } = new URL(url)
    const log = createLogger("worker")

    log.info("Request received", { method, path: pathname })

    if (method === "GET" && pathname === "/") {
      const body = { status: "ok", timestamp: new Date().toISOString() }
      log.info("Health check", body)
      return Response.json(body)
    }

    if (method === "POST") {
      if (pathname === CATCH_UP_OUTBOX_EVENTS_PATH) {
        return handleCatchUpOutboxEventsSchedule(request)
      }

      const day = DAY_ROUTES[pathname]
      if (day) return handleSchedule(request, day)
    }

    log.warn("Route not found", { method, path: pathname })
    return new Response("Not Found", { status: 404 })
  },
}
