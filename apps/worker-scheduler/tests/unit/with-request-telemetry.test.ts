import { describe, it, expect, vi } from "vitest"
import type {
  ObservabilityPort,
  SpanHandle,
  TelemetryAttributeValue,
  TelemetryAttributes,
} from "../../src/domain/ports/observability.port"
import { withRequestTelemetry } from "../../src/infrastructure/observability/with-request-telemetry"

class RecordingObservability implements ObservabilityPort {
  readonly spans: Array<{ name: string; attributes: Record<string, TelemetryAttributeValue> }> = []
  readonly metrics: Array<{ name: string; value: number; attributes?: TelemetryAttributes }> = []
  flushCalls = 0
  flushImpl: () => Promise<void> = async () => undefined

  startSpan(name: string, attributes?: TelemetryAttributes): SpanHandle {
    const attrs: Record<string, TelemetryAttributeValue> = { ...attributes }
    this.spans.push({ name, attributes: attrs })
    return {
      setAttribute: (key, value) => {
        attrs[key] = value
      },
      recordException: (err) => {
        attrs["exception.message"] = err instanceof Error ? err.message : String(err)
      },
      end: () => undefined,
    }
  }

  recordMetric(name: string, value: number, attributes?: TelemetryAttributes): void {
    this.metrics.push({ name, value, attributes })
  }

  logger() {
    return {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
  }

  async flush(): Promise<void> {
    this.flushCalls += 1
    await this.flushImpl()
  }

  async shutdown(): Promise<void> {
    await this.flush()
  }
}

function makeRequest(method: string, path: string): Request {
  return new Request(`https://worker-scheduler.workers.dev${path}`, { method })
}

function makeCtx(waitUntil: (promise: Promise<unknown>) => void = () => undefined): Pick<
  ExecutionContext,
  "waitUntil"
> {
  return { waitUntil }
}

describe("withRequestTelemetry", () => {
  it("records method, route, and status 200 plus duration/count metrics", async () => {
    const obs = new RecordingObservability()
    const waitUntil = vi.fn()
    const res = await withRequestTelemetry(obs, makeRequest("GET", "/"), makeCtx(waitUntil), async () =>
      Response.json({ status: "ok" }),
    )
    expect(res.status).toBe(200)
    expect(obs.spans[0]?.name).toBe("HTTP GET")
    expect(obs.spans[0]?.attributes).toMatchObject({
      "http.request.method": "GET",
      "http.route": "/",
      "http.response.status_code": 200,
    })
    expect(obs.metrics.map((m) => m.name)).toEqual([
      "http.server.request.count",
      "http.server.request.duration",
    ])
    expect(waitUntil).toHaveBeenCalledOnce()
  })

  it("records status 401 and still returns the inner response when flush rejects", async () => {
    const obs = new RecordingObservability()
    obs.flushImpl = async () => {
      throw new Error("otlp down")
    }
    const pending: Array<Promise<unknown>> = []
    const waitUntil = (promise: Promise<unknown>) => {
      pending.push(promise)
    }
    const res = await withRequestTelemetry(
      obs,
      makeRequest("POST", "/generate-weekly-outfits"),
      makeCtx(waitUntil),
      async () => new Response("Unauthorized", { status: 401 }),
    )
    expect(res.status).toBe(401)
    expect(obs.spans[0]?.attributes["http.response.status_code"]).toBe(401)
    await Promise.all(pending)
    expect(obs.flushCalls).toBe(1)
  })
})
