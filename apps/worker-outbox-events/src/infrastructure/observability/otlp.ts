import type { TelemetryAttributeValue, TelemetryAttributes } from "../../domain/ports/observability.port"

export interface OtlpKeyValue {
  key: string
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean }
}

export function unixNanoNow(): string {
  return `${Date.now()}000000`
}

export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function normalizeOtlpEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, "")
}

export function parseOtlpHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=")
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key.length > 0) headers[key] = value
  }
  return headers
}

const TRACEPARENT_RE = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/i

export function parseTraceparent(
  header: string | null | undefined,
): { traceId: string; parentSpanId: string } | undefined {
  if (!header) return undefined
  const match = TRACEPARENT_RE.exec(header.trim())
  if (!match?.[1] || !match[2]) return undefined
  return { traceId: match[1].toLowerCase(), parentSpanId: match[2].toLowerCase() }
}

export function otlpAttribute(key: string, value: TelemetryAttributeValue): OtlpKeyValue {
  if (typeof value === "string") return { key, value: { stringValue: value } }
  if (typeof value === "boolean") return { key, value: { boolValue: value } }
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } }
  return { key, value: { doubleValue: value } }
}

export function otlpAttributes(attributes?: TelemetryAttributes): OtlpKeyValue[] {
  if (!attributes) return []
  return Object.entries(attributes).map(([key, value]) => otlpAttribute(key, value))
}

export function exceptionMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
