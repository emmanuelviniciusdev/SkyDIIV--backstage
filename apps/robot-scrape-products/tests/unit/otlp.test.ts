import { describe, expect, it } from "vitest"
import { describeOtlpHeadersEnv, otlpAuthorizationScheme, parseOtlpHeaders } from "../../src/infrastructure/observability/otlp.js"

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

describe("parseOtlpHeaders", () => {
  it("parses unencoded Grafana Basic auth", () => {
    expect(parseOtlpHeaders("Authorization=Basic abc123")).toEqual({
      Authorization: "Basic abc123",
    })
  })

  it("percent-decodes Grafana Cloud portal values (Basic%20)", () => {
    expect(parseOtlpHeaders("Authorization=Basic%20abc123%3D%3D")).toEqual({
      Authorization: "Basic abc123==",
    })
  })

  it("strips wrapping quotes used when pasting export snippets", () => {
    expect(parseOtlpHeaders('"Authorization=Basic%20abc123"')).toEqual({
      Authorization: "Basic abc123",
    })
  })

  it("accepts a full export assignment line", () => {
    expect(
      parseOtlpHeaders('export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20abc123"'),
    ).toEqual({ Authorization: "Basic abc123" })
  })

  it("accepts an HTTP header line with a colon", () => {
    expect(parseOtlpHeaders("Authorization: Basic abc123==")).toEqual({
      Authorization: "Basic abc123==",
    })
  })

  it("treats a bare Basic value as Authorization", () => {
    expect(parseOtlpHeaders("Basic abc123")).toEqual({
      Authorization: "Basic abc123",
    })
  })

  it("keeps additional header pairs", () => {
    expect(parseOtlpHeaders("Authorization=Basic abc,X-Scope-OrgID=1")).toEqual({
      Authorization: "Basic abc",
      "X-Scope-OrgID": "1",
    })
  })

  it("keeps invalid percent sequences as-is", () => {
    expect(parseOtlpHeaders("Authorization=Basic%")).toEqual({
      Authorization: "Basic%",
    })
  })

  it("treats a bare base64 credential blob as Basic auth", () => {
    const blob = utf8ToBase64("33755:glc_eyJtesttoken")
    expect(blob.length).toBeGreaterThanOrEqual(16)
    expect(parseOtlpHeaders(blob)).toEqual({
      Authorization: `Basic ${blob}`,
    })
  })

  it("reconstructs a base64 blob whose padding was split on =", () => {
    const blob = `${"A".repeat(20)}==`
    expect(parseOtlpHeaders(blob)).toEqual({
      Authorization: `Basic ${blob}`,
    })
  })

  it("base64-encodes instanceId:token into Basic auth", () => {
    const pair = "33755:glc_eyJtesttoken"
    expect(parseOtlpHeaders(pair)).toEqual({
      Authorization: `Basic ${utf8ToBase64(pair)}`,
    })
  })

  it("parses a JSON header map", () => {
    expect(parseOtlpHeaders('{"Authorization":"Basic abc123"}')).toEqual({
      Authorization: "Basic abc123",
    })
  })
})

describe("describeOtlpHeadersEnv", () => {
  it("fingerprints the env without echoing the secret", () => {
    const blob = utf8ToBase64("33755:glc_eyJtesttoken")
    const shape = describeOtlpHeadersEnv(blob)
    expect(JSON.stringify(shape)).not.toContain(blob)
    expect(shape).toMatchObject({
      rawLen: blob.length,
      hasAuthorizationWord: false,
      hasBasicWord: false,
      looksLikeBase64: true,
      looksLikeGrafanaToken: false,
    })
  })
})

describe("otlpAuthorizationScheme", () => {
  it("classifies Basic, Bearer, other, and missing", () => {
    expect(otlpAuthorizationScheme({ Authorization: "Basic abc" })).toBe("basic")
    expect(otlpAuthorizationScheme({ Authorization: "Bearer tok" })).toBe("bearer")
    expect(otlpAuthorizationScheme({ Authorization: "Basic%20abc" })).toBe("other")
    expect(otlpAuthorizationScheme({})).toBe("missing")
  })
})
