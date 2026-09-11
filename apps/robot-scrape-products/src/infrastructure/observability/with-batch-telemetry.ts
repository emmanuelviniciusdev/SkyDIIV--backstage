import type { ObservabilityPort, TelemetryAttributes } from "../../domain/ports/observability.port.js"

const BATCH_HEARTBEAT_MS = 60_000

export async function withBatchTelemetry(
  observability: ObservabilityPort,
  attributes: TelemetryAttributes,
  run: () => Promise<void>,
): Promise<void> {
  const span = observability.startSpan("batch.run", attributes)
  const startedAt = Date.now()

  const emitRunning = () => {
    observability.recordMetric("batch.run.count", 1, { "batch.status": "running" })
  }

  const flushQuietly = () => Promise.resolve(observability.flush()).catch(() => undefined)

  emitRunning()
  await flushQuietly()

  const heartbeat = setInterval(() => {
    emitRunning()
    void flushQuietly()
  }, BATCH_HEARTBEAT_MS)

  const finish = (status: string) => {
    span.setAttribute("batch.status", status)
    observability.recordMetric("batch.run.count", 1, { "batch.status": status })
    observability.recordMetric("batch.run.duration", Date.now() - startedAt, {
      "batch.status": status,
    })
    span.end()
  }

  try {
    await run()
    finish("success")
  } catch (err: unknown) {
    span.recordException(err)
    finish("error")
    throw err
  } finally {
    clearInterval(heartbeat)
    await Promise.resolve(observability.shutdown()).catch(() => undefined)
  }
}
