import { describe, it, expect } from "vitest"
import type {
  ObservabilityPort,
  SpanHandle,
  TelemetryAttributeValue,
  TelemetryAttributes,
} from "../../src/domain/ports/observability.port.js"
import { withBatchTelemetry } from "../../src/infrastructure/observability/with-batch-telemetry.js"

class RecordingObservability implements ObservabilityPort {
  readonly spans: Array<{ name: string; attributes: Record<string, TelemetryAttributeValue> }> =
    []
  runnerCompleted = false
  shutdownCalls = 0
  shutdownImpl: () => Promise<void> = async () => undefined

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

  recordMetric(): void {
    /* unused */
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
    await this.shutdown()
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1
    await this.shutdownImpl()
  }
}

describe("withBatchTelemetry", () => {
  it("records a successful batch span and still completes the runner when shutdown rejects", async () => {
    const obs = new RecordingObservability()
    obs.shutdownImpl = async () => {
      throw new Error("otlp down")
    }
    const sideEffects = { scrapePersisted: false, outboxPublished: false }

    await withBatchTelemetry(obs, { "compute.provider": "noop" }, async () => {
      sideEffects.scrapePersisted = true
      sideEffects.outboxPublished = true
    })

    expect(sideEffects).toEqual({ scrapePersisted: true, outboxPublished: true })
    expect(obs.spans[0]?.name).toBe("batch.run")
    expect(obs.spans[0]?.attributes["batch.status"]).toBe("success")
    expect(obs.spans[0]?.attributes["compute.provider"]).toBe("noop")
    expect(obs.shutdownCalls).toBe(1)
  })
})
