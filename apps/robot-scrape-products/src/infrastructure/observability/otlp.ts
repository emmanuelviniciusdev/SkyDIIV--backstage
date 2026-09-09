import type { TelemetryAttributeValue, TelemetryAttributes } from "../../domain/ports/observability.port.js"

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

export type OtlpAuthorizationScheme = "missing" | "basic" | "bearer" | "other"

export interface OtlpHeadersEnvShape {
  rawLen: number
  hasAuthorizationWord: boolean
  hasBasicWord: boolean
  hasBearerWord: boolean
  hasEquals: boolean
  hasColon: boolean
  hasPercent: boolean
  looksLikeBase64: boolean
  looksLikeGrafanaToken: boolean
  looksLikeInstanceToken: boolean
}

/**
 * Parse `OTEL_EXPORTER_OTLP_HEADERS`.
 *
 * Grafana Cloud pastes we accept:
 * - `Authorization=Basic%20…` (OTLP spec, percent-encoded)
 * - `Authorization=Basic …` / `Authorization: Basic …`
 * - the base64 blob alone (`base64(instanceId:token)`), which `=` splitting
 *   otherwise turns into a fake header pair and Grafana 401s with no credentials
 * - `instanceId:glc_…` (we Base64-encode into Basic)
 */
export function parseOtlpHeaders(raw: string): Record<string, string> {
  const prepared = unwrapOtlpHeadersEnv(raw)

  const fromJson = parseOtlpHeadersJson(prepared)
  if (fromJson && authorizationValue(fromJson)) return canonicalizeAuthorization(fromJson)

  const fromPairs = parseOtlpHeaderPairs(prepared)
  if (authorizationValue(fromPairs)) return canonicalizeAuthorization(fromPairs)

  const decodedWhole = percentDecode(prepared)
  if (decodedWhole !== prepared) {
    const fromDecoded = parseOtlpHeaderPairs(decodedWhole)
    if (authorizationValue(fromDecoded)) return canonicalizeAuthorization(fromDecoded)
  }

  const fallback = authorizationFromBareValue(decodedWhole)
  if (fallback) return { Authorization: fallback }

  const instanceToken = authorizationFromInstanceToken(decodedWhole)
  if (instanceToken) return { Authorization: instanceToken }

  const blob = authorizationFromCredentialBlob(decodedWhole, fromPairs)
  if (blob) return { Authorization: blob }

  return canonicalizeAuthorization(fromPairs)
}

export function otlpAuthorizationScheme(headers: Record<string, string>): OtlpAuthorizationScheme {
  const value = authorizationValue(headers)
  if (!value) return "missing"
  if (/^Basic\s+\S/i.test(value)) return "basic"
  if (/^Bearer\s+\S/i.test(value)) return "bearer"
  return "other"
}

/** Safe fingerprint of the raw env (length/flags only — never the secret). */
export function describeOtlpHeadersEnv(raw: string): OtlpHeadersEnvShape {
  const prepared = unwrapOtlpHeadersEnv(raw)
  const compact = prepared.replace(/\s+/g, "")
  const decoded = percentDecode(prepared).trim()
  return {
    rawLen: raw.length,
    hasAuthorizationWord: /authorization/i.test(prepared),
    hasBasicWord: /basic/i.test(prepared),
    hasBearerWord: /bearer/i.test(prepared),
    hasEquals: prepared.includes("="),
    hasColon: prepared.includes(":"),
    hasPercent: prepared.includes("%"),
    looksLikeBase64: looksLikeEncodedBasicBlob(compact) || looksLikeEncodedBasicBlob(decoded.replace(/\s+/g, "")),
    looksLikeGrafanaToken: /^(glc_|glsa_)/i.test(compact),
    looksLikeInstanceToken: looksLikeInstanceTokenPair(decoded),
  }
}

function unwrapOtlpHeadersEnv(raw: string): string {
  let value = stripWrappingQuotes(stripInvisible(raw).trim())
  const assigned = /^(?:export\s+)?OTEL_EXPORTER_OTLP_HEADERS\s*=\s*([\s\S]*)$/i.exec(value)
  if (assigned?.[1] != null) {
    value = stripWrappingQuotes(assigned[1].trim())
  }
  return value
}

function parseOtlpHeadersJson(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("{")) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && key.length > 0) headers[key] = value
    }
    return headers
  } catch {
    return undefined
  }
}

function parseOtlpHeaderPairs(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const part of raw.split(/[\n,;]+/)) {
    const idx = part.indexOf("=")
    if (idx <= 0) continue
    const key = stripInvisible(percentDecode(part.slice(0, idx).trim()))
    const value = stripWrappingQuotes(percentDecode(part.slice(idx + 1).trim()))
    if (key.length > 0) headers[key] = value
  }
  return headers
}

function authorizationFromBareValue(raw: string): string | undefined {
  const trimmed = stripWrappingQuotes(raw.trim())
  const colon = /^Authorization\s*:\s*(\S[\s\S]*)$/i.exec(trimmed)
  if (colon?.[1]) return percentDecode(colon[1].trim())
  if (/^(Basic|Bearer)\s+\S/i.test(trimmed)) return trimmed
  return undefined
}

function authorizationFromInstanceToken(raw: string): string | undefined {
  const trimmed = stripWrappingQuotes(raw.trim())
  if (!looksLikeInstanceTokenPair(trimmed)) return undefined
  return `Basic ${utf8ToBase64(trimmed)}`
}

function authorizationFromCredentialBlob(
  raw: string,
  misparsed: Record<string, string>,
): string | undefined {
  const compact = stripWrappingQuotes(raw.trim()).replace(/\s+/g, "")
  if (looksLikeEncodedBasicBlob(compact)) return `Basic ${compact}`

  const keys = Object.keys(misparsed)
  const key = keys[0]
  if (keys.length === 1 && key !== undefined) {
    const reconstructed = `${key}=${misparsed[key]}`.replace(/\s+/g, "")
    if (looksLikeEncodedBasicBlob(reconstructed)) return `Basic ${reconstructed}`
  }
  return undefined
}

function looksLikeEncodedBasicBlob(value: string): boolean {
  if (value.length < 16) return false
  if (/^(glc_|glsa_|basic|bearer|authorization)/i.test(value)) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) || /^[A-Za-z0-9_-]+={0,2}$/.test(value)
}

function looksLikeInstanceTokenPair(value: string): boolean {
  return /^\d+:\S+$/.test(value)
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function stripInvisible(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/[\u200B\u00A0]/g, "")
}

function authorizationValue(headers: Record<string, string>): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization" && value.trim()) return value
  }
  return undefined
}

function canonicalizeAuthorization(headers: Record<string, string>): Record<string, string> {
  const value = authorizationValue(headers)
  if (!value) return headers
  const next: Record<string, string> = {}
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") continue
    next[key] = val
  }
  next.Authorization = value
  return next
}

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const start = value[0]
    const end = value[value.length - 1]
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
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
