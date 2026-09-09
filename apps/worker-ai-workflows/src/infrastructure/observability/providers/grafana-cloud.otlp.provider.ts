import type { LogLevel, Logger } from "../../../domain/ports/logger.port"
import type {
  ObservabilityPort,
  SpanHandle,
  TelemetryAttributeValue,
  TelemetryAttributes,
} from "../../../domain/ports/observability.port"
import { emitConsoleNdjson } from "../console-ndjson"
import {
  exceptionMessage,
  normalizeOtlpEndpoint,
  otlpAttribute,
  otlpAttributes,
  parseOtlpHeaders,
  parseTraceparent,
  randomHex,
  unixNanoNow,
  type OtlpKeyValue,
} from "../otlp"

const SCOPE_NAME = "skydiiv.observability"

const SEVERITY: Record<LogLevel, { number: number; text: string }> = {
  DEBUG: { number: 5, text: "DEBUG" },
  INFO: { number: 9, text: "INFO" },
  WARN: { number: 13, text: "WARN" },
  ERROR: { number: 17, text: "ERROR" },
}

interface BufferedSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpKeyValue[]
  statusCode: 1 | 2
  statusMessage?: string
}

interface BufferedMetric {
  name: string
  value: number
  timeUnixNano: string
  attributes: OtlpKeyValue[]
}

interface BufferedLog {
  timeUnixNano: string
  severityNumber: number
  severityText: string
  body: string
  attributes: OtlpKeyValue[]
  traceId?: string
  spanId?: string
}

export interface GrafanaCloudOtlpProviderConfig {
  serviceName: string
  deploymentEnvironment: string
  endpoint: string
  headers: string
}

class GrafanaSpanHandle implements SpanHandle {
  private ended = false
  private statusCode: 1 | 2 = 1
  private statusMessage?: string
  private readonly attributes: OtlpKeyValue[]

  constructor(
    private readonly provider: GrafanaCloudOtlpProvider,
    readonly traceId: string,
    readonly spanId: string,
    private readonly parentSpanId: string | undefined,
    private readonly name: string,
    private readonly startTimeUnixNano: string,
    initial: TelemetryAttributes | undefined,
  ) {
    this.attributes = otlpAttributes(initial)
  }

  setAttribute(key: string, value: TelemetryAttributeValue): void {
    this.attributes.push(otlpAttribute(key, value))
  }

  recordException(err: unknown): void {
    this.statusCode = 2
    this.statusMessage = exceptionMessage(err)
    this.attributes.push(otlpAttribute("exception.message", this.statusMessage))
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.provider.bufferSpan({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTimeUnixNano: this.startTimeUnixNano,
      endTimeUnixNano: unixNanoNow(),
      attributes: this.attributes,
      statusCode: this.statusCode,
      statusMessage: this.statusMessage,
    })
    this.provider.clearActiveSpan(this.spanId)
  }
}

export class GrafanaCloudOtlpProvider implements ObservabilityPort {
  private readonly endpoint: string
  private readonly headers: Record<string, string>
  private readonly resourceAttributes: OtlpKeyValue[]
  private readonly spans: BufferedSpan[] = []
  private readonly metrics: BufferedMetric[] = []
  private readonly logs: BufferedLog[] = []
  private activeSpan: { traceId: string; spanId: string } | undefined
  private incomingTrace: { traceId: string; parentSpanId: string } | undefined

  constructor(private readonly config: GrafanaCloudOtlpProviderConfig) {
    this.endpoint = normalizeOtlpEndpoint(config.endpoint)
    this.headers = parseOtlpHeaders(config.headers)
    this.resourceAttributes = [
      otlpAttribute("service.name", config.serviceName),
      otlpAttribute("service.namespace", "skydiiv-backstage"),
      otlpAttribute("deployment.environment", config.deploymentEnvironment),
    ]
  }

  /** Honor an incoming W3C traceparent on the next startSpan. */
  setIncomingTraceparent(header: string | null | undefined): void {
    this.incomingTrace = parseTraceparent(header)
  }

  startSpan(name: string, attributes?: TelemetryAttributes): SpanHandle {
    const parent = this.incomingTrace
    this.incomingTrace = undefined
    const traceId = parent?.traceId ?? randomHex(16)
    const spanId = randomHex(8)
    const handle = new GrafanaSpanHandle(
      this,
      traceId,
      spanId,
      parent?.parentSpanId,
      name,
      unixNanoNow(),
      attributes,
    )
    this.activeSpan = { traceId, spanId }
    return handle
  }

  recordMetric(name: string, value: number, attributes?: TelemetryAttributes): void {
    this.metrics.push({
      name,
      value,
      timeUnixNano: unixNanoNow(),
      attributes: otlpAttributes(attributes),
    })
  }

  logger(step: string, context?: Record<string, string>): Logger {
    const base: Record<string, unknown> = { step, ...context }
    const emit = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => {
      const ctx = { ...base, ...extra }
      emitConsoleNdjson(this.config.serviceName, level, msg, ctx)
      const severity = SEVERITY[level]
      const logAttributes = otlpAttributes(
        Object.fromEntries(
          Object.entries(ctx)
            .filter((entry): entry is [string, TelemetryAttributeValue] => {
              const value = entry[1]
              return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            }),
        ),
      )
      this.logs.push({
        timeUnixNano: unixNanoNow(),
        severityNumber: severity.number,
        severityText: severity.text,
        body: msg,
        attributes: logAttributes,
        traceId: this.activeSpan?.traceId,
        spanId: this.activeSpan?.spanId,
      })
    }
    return {
      debug: (msg, extra) => emit("DEBUG", msg, extra),
      info: (msg, extra) => emit("INFO", msg, extra),
      warn: (msg, extra) => emit("WARN", msg, extra),
      error: (msg, extra) => emit("ERROR", msg, extra),
    }
  }

  bufferSpan(span: BufferedSpan): void {
    this.spans.push(span)
  }

  clearActiveSpan(spanId: string): void {
    if (this.activeSpan?.spanId === spanId) this.activeSpan = undefined
  }

  async flush(): Promise<void> {
    const traces = this.spans.splice(0)
    const metrics = this.metrics.splice(0)
    const logs = this.logs.splice(0)
    await Promise.all([
      traces.length > 0 ? this.postJson("/v1/traces", this.tracesPayload(traces)) : Promise.resolve(),
      metrics.length > 0 ? this.postJson("/v1/metrics", this.metricsPayload(metrics)) : Promise.resolve(),
      logs.length > 0 ? this.postJson("/v1/logs", this.logsPayload(logs)) : Promise.resolve(),
    ])
  }

  async shutdown(): Promise<void> {
    await this.flush()
  }

  private tracesPayload(spans: BufferedSpan[]): unknown {
    return {
      resourceSpans: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeSpans: [
            {
              scope: { name: SCOPE_NAME },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                kind: 2,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                attributes: span.attributes,
                status: {
                  code: span.statusCode,
                  message: span.statusMessage,
                },
              })),
            },
          ],
        },
      ],
    }
  }

  private metricsPayload(metrics: BufferedMetric[]): unknown {
    return {
      resourceMetrics: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeMetrics: [
            {
              scope: { name: SCOPE_NAME },
              metrics: metrics.map((metric) => ({
                name: metric.name,
                gauge: {
                  dataPoints: [
                    {
                      asDouble: metric.value,
                      timeUnixNano: metric.timeUnixNano,
                      attributes: metric.attributes,
                    },
                  ],
                },
              })),
            },
          ],
        },
      ],
    }
  }

  private logsPayload(logs: BufferedLog[]): unknown {
    return {
      resourceLogs: [
        {
          resource: { attributes: this.resourceAttributes },
          scopeLogs: [
            {
              scope: { name: SCOPE_NAME },
              logRecords: logs.map((log) => ({
                timeUnixNano: log.timeUnixNano,
                severityNumber: log.severityNumber,
                severityText: log.severityText,
                body: { stringValue: log.body },
                attributes: log.attributes,
                traceId: log.traceId,
                spanId: log.spanId,
              })),
            },
          ],
        },
      ],
    }
  }

  private async postJson(path: string, body: unknown): Promise<void> {
    const url = `${this.endpoint}${path}`
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        console.warn(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "WARN",
            app: this.config.serviceName,
            msg: "OTLP export rejected",
            path,
            status: response.status,
          }),
        )
      }
    } catch (err: unknown) {
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "WARN",
          app: this.config.serviceName,
          msg: "OTLP export failed",
          path,
          error: exceptionMessage(err),
        }),
      )
    }
  }
}
