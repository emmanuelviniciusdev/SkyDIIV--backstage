import { handleCatchUpOutboxEventsSchedule } from "./handlers/catch-up-outbox-events.schedule"
import { handleEverydaySchedule } from "./handlers/everyday.schedule"
import { resetDbClient } from "./lib/db/client"
import { handleSchedule } from "./scheduler"
import { createLogger } from "./lib/logger"
import type { Weekday } from "./flows/types"
import { createObservabilityProvider } from "./infrastructure/observability/observability.factory"
import { withRequestTelemetry } from "./infrastructure/observability/with-request-telemetry"

type Env = Record<string, string | undefined>

const SERVICE_NAME = "worker-scheduler"

const CATCH_UP_OUTBOX_EVENTS_PATH = "/schedule/catch-up-outbox-events"
const EVERYDAY_PATH = "/schedule/everyday"

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
 * POST /schedule/everyday                 → signed trigger; runs registered everyday flows.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    Object.assign(process.env, env)
    // CF Workers isolates are reused across requests; drop any postgres.js
    // connection from a prior request so I/O stays scoped to this handler.
    resetDbClient()

    const observability = createObservabilityProvider({
      provider: env.OBSERVABILITY_PROVIDER,
      serviceName: env.OTEL_SERVICE_NAME?.trim() || SERVICE_NAME,
      deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT,
      otlp: {
        endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: env.OTEL_EXPORTER_OTLP_HEADERS,
      },
    })

    return withRequestTelemetry(observability, request, ctx, () => handleRequest(request))
  },
}

async function handleRequest(request: Request): Promise<Response> {
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

    if (pathname === EVERYDAY_PATH) {
      return handleEverydaySchedule(request)
    }

    const day = DAY_ROUTES[pathname]
    if (day) return handleSchedule(request, day)
  }

  log.warn("Route not found", { method, path: pathname })
  return new Response("Not Found", { status: 404 })
}
