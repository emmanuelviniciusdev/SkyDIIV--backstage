import type { Logger } from "../../../domain/ports/logger.port"
import type {
  ObservabilityPort,
  SpanHandle,
  TelemetryAttributeValue,
  TelemetryAttributes,
} from "../../../domain/ports/observability.port"
import { createConsoleLogger } from "../console-ndjson"

class NoopSpan implements SpanHandle {
  setAttribute(key: string, value: TelemetryAttributeValue): void {
    void key
    void value
  }

  recordException(err: unknown): void {
    void err
  }

  end(): void {
    /* noop */
  }
}

export class NoopObservabilityProvider implements ObservabilityPort {
  constructor(private readonly serviceName: string) {}

  startSpan(name: string, attributes?: TelemetryAttributes): SpanHandle {
    void name
    void attributes
    return new NoopSpan()
  }

  recordMetric(name: string, value: number, attributes?: TelemetryAttributes): void {
    void name
    void value
    void attributes
  }

  logger(step: string, context?: Record<string, string>): Logger {
    return createConsoleLogger(this.serviceName, step, context)
  }

  async flush(): Promise<void> {
    /* noop */
  }

  async shutdown(): Promise<void> {
    /* noop */
  }
}
