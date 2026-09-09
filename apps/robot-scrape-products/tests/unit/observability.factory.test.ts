import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createObservabilityProvider } from "../../src/infrastructure/observability/observability.factory.js"
import { GrafanaCloudOtlpProvider } from "../../src/infrastructure/observability/providers/grafana-cloud.otlp.provider.js"
import { NoopObservabilityProvider } from "../../src/infrastructure/observability/providers/noop.provider.js"

const ENDPOINT = "https://otlp-gateway.example/otlp"
const HEADERS = "Authorization=Basic abc123"

function otlpInput() {
  return {
    serviceName: "robot-scrape-products",
    deploymentEnvironment: "test",
    otlp: { endpoint: ENDPOINT, headers: HEADERS },
  }
}

describe("createObservabilityProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns noop when provider is noop", () => {
    const port = createObservabilityProvider({
      provider: "noop",
      ...otlpInput(),
    })
    expect(port).toBeInstanceOf(NoopObservabilityProvider)
  })

  it("returns grafana-cloud when provider is grafana-cloud and credentials are set", () => {
    const port = createObservabilityProvider({
      provider: "grafana-cloud",
      ...otlpInput(),
    })
    expect(port).toBeInstanceOf(GrafanaCloudOtlpProvider)
  })

  it("auto-detects grafana-cloud when credentials are present and provider is unset", () => {
    const port = createObservabilityProvider(otlpInput())
    expect(port).toBeInstanceOf(GrafanaCloudOtlpProvider)
  })

  it("auto-detects noop when credentials are absent and provider is unset", () => {
    const port = createObservabilityProvider({
      serviceName: "robot-scrape-products",
    })
    expect(port).toBeInstanceOf(NoopObservabilityProvider)
  })

  it("falls back to noop when grafana-cloud is explicit but credentials are incomplete", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const port = createObservabilityProvider({
      provider: "grafana-cloud",
      serviceName: "robot-scrape-products",
      otlp: { endpoint: ENDPOINT },
    })
    expect(port).toBeInstanceOf(NoopObservabilityProvider)
    expect(warn).toHaveBeenCalled()
  })

  it("throws on an unknown provider id", () => {
    expect(() =>
      createObservabilityProvider({
        provider: "datadog",
        serviceName: "robot-scrape-products",
      }),
    ).toThrow(/Unknown OBSERVABILITY_PROVIDER "datadog"/)
  })
})

describe("GrafanaCloudOtlpProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("POSTs traces, metrics, and logs to the OTLP HTTP JSON paths with configured headers", async () => {
    const port = new GrafanaCloudOtlpProvider({
      serviceName: "robot-scrape-products",
      deploymentEnvironment: "staging",
      endpoint: `${ENDPOINT}/`,
      headers: HEADERS,
    })
    const span = port.startSpan("HTTP GET", { "http.request.method": "GET", "http.route": "/" })
    span.setAttribute("http.response.status_code", 200)
    span.end()
    port.recordMetric("http.server.request.count", 1, { "http.response.status_code": 200 })
    port.logger("worker").info("Health check", { path: "/" })
    await port.flush()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual([
      `${ENDPOINT}/v1/traces`,
      `${ENDPOINT}/v1/metrics`,
      `${ENDPOINT}/v1/logs`,
    ])

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      expect(init.method).toBe("POST")
      const headers = new Headers(init.headers)
      expect(headers.get("content-type")).toBe("application/json")
      expect(headers.get("Authorization")).toBe("Basic abc123")
    }

    const tracesInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const tracesRaw = tracesInit.body
    expect(typeof tracesRaw).toBe("string")
    const tracesBody = JSON.parse(tracesRaw as string) as {
      resourceSpans: {
        resource: { attributes: { key: string }[] }
        scopeSpans: { spans: { name: string }[] }[]
      }[]
    }
    const resourceKeys = tracesBody.resourceSpans[0]?.resource.attributes.map((a) => a.key)
    expect(resourceKeys).toEqual(
      expect.arrayContaining(["service.name", "service.namespace", "deployment.environment"]),
    )
    expect(tracesBody.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name).toBe("HTTP GET")
  })

  it("does not throw from flush when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const port = new GrafanaCloudOtlpProvider({
      serviceName: "robot-scrape-products",
      deploymentEnvironment: "staging",
      endpoint: ENDPOINT,
      headers: HEADERS,
    })
    port.startSpan("HTTP GET").end()
    await expect(port.flush()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it("sends Authorization from a bare base64 credential blob", async () => {
    const bytes = new TextEncoder().encode("33755:glc_eyJtesttoken")
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const blob = btoa(binary)
    const port = new GrafanaCloudOtlpProvider({
      serviceName: "robot-scrape-products",
      deploymentEnvironment: "staging",
      endpoint: ENDPOINT,
      headers: blob,
    })
    port.startSpan("HTTP GET").end()
    await port.flush()
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get("Authorization")).toBe(`Basic ${blob}`)
  })

  it("logs Grafana error text and auth scheme when export returns 401", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"status":"error","error":"authentication error: no credentials provided"}', {
        status: 401,
      }),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const port = new GrafanaCloudOtlpProvider({
      serviceName: "robot-scrape-products",
      deploymentEnvironment: "staging",
      endpoint: ENDPOINT,
      headers: HEADERS,
    })
    port.logger("worker").info("request")
    await port.flush()
    expect(warn).toHaveBeenCalled()
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      msg: string
      status: number
      auth: string
      grafanaError: string
      headersEnv: { hasAuthorizationWord: boolean; hasBasicWord: boolean }
    }
    expect(payload).toMatchObject({
      msg: "OTLP export rejected",
      status: 401,
      auth: "basic",
    })
    expect(payload.grafanaError).toContain("no credentials provided")
    expect(payload.headersEnv).toMatchObject({
      hasAuthorizationWord: true,
      hasBasicWord: true,
    })
  })
})

describe("NoopObservabilityProvider", () => {
  it("never calls fetch on flush", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const port = new NoopObservabilityProvider("robot-scrape-products")
    port.startSpan("HTTP GET").end()
    port.recordMetric("http.server.request.count", 1)
    port.logger("worker").info("Health check")
    await port.flush()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
