import type { ObservabilityPort } from "../../domain/ports/observability.port"
import { GrafanaCloudOtlpProvider } from "./providers/grafana-cloud.otlp.provider"
import { runWithObservability } from "./observability-context"

const COUNT_METRIC = "http.server.request.count"
const DURATION_METRIC = "http.server.request.duration"

export async function withRequestTelemetry(
  observability: ObservabilityPort,
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
  handler: () => Promise<Response>,
): Promise<Response> {
  return runWithObservability(observability, async () => {
    if (observability instanceof GrafanaCloudOtlpProvider) {
      observability.setIncomingTraceparent(request.headers.get("traceparent"))
    }

    const url = new URL(request.url)
    const method = request.method
    const route = url.pathname
    const span = observability.startSpan(`HTTP ${method}`, {
      "http.request.method": method,
      "http.route": route,
    })
    const startedAt = Date.now()

    const record = (status: number) => {
      const attributes = {
        "http.request.method": method,
        "http.route": route,
        "http.response.status_code": status,
      }
      span.setAttribute("http.response.status_code", status)
      observability.recordMetric(COUNT_METRIC, 1, attributes)
      observability.recordMetric(DURATION_METRIC, Date.now() - startedAt, attributes)
      span.end()
      ctx.waitUntil(Promise.resolve(observability.flush()).catch(() => undefined))
    }

    try {
      const response = await handler()
      record(response.status)
      return response
    } catch (err: unknown) {
      span.recordException(err)
      record(500)
      throw err
    }
  })
}
