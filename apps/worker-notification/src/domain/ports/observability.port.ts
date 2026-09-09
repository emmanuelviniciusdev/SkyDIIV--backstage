import type { Logger } from "./logger.port"

export type TelemetryAttributeValue = string | number | boolean

export type TelemetryAttributes = Record<string, TelemetryAttributeValue>

export interface SpanHandle {
  setAttribute(key: string, value: TelemetryAttributeValue): void
  recordException(err: unknown): void
  end(): void
}

/**
 * Vendor-agnostic telemetry port. Application code depends on this, never on
 * Grafana, OpenTelemetry packages, or OTLP types.
 */
export interface ObservabilityPort {
  startSpan(name: string, attributes?: TelemetryAttributes): SpanHandle
  recordMetric(name: string, value: number, attributes?: TelemetryAttributes): void
  logger(step: string, context?: Record<string, string>): Logger
  flush(): Promise<void>
  shutdown(): Promise<void>
}
