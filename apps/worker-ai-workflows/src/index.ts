import { workflowsFetch } from "./workflows"
import { createLogger } from "./lib/logger"
import { setImages, type ImagesBinding } from "./lib/cf-images"
import { createObservabilityProvider } from "./infrastructure/observability/observability.factory"
import { withRequestTelemetry } from "./infrastructure/observability/with-request-telemetry"

type Env = Record<string, string | undefined> & {
  IMAGES?: ImagesBinding
}

const SERVICE_NAME = "worker-ai-workflows"

/**
 * Cloudflare Worker entry point — worker-ai-workflows.
 *
 * A generic host for AI-related Upstash Workflows. Copies all Worker bindings
 * into process.env so downstream modules that read process.env work without
 * modification, then delegates to the @upstash/workflow serveMany router.
 *
 * GET / → health-check (useful for uptime monitors).
 * All other paths → serveMany, which dispatches by the last path segment:
 *   POST /generate-weekly-outfits → generate-weekly-outfits workflow
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    Object.assign(process.env, env)
    if (env.IMAGES) setImages(env.IMAGES)

    const observability = createObservabilityProvider({
      provider: env.OBSERVABILITY_PROVIDER,
      serviceName: env.OTEL_SERVICE_NAME?.trim() || SERVICE_NAME,
      deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT,
      otlp: {
        endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
        headers: env.OTEL_EXPORTER_OTLP_HEADERS,
      },
    })

    return withRequestTelemetry(observability, request, ctx, () => handleRequest(request, env))
  },
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
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
}
