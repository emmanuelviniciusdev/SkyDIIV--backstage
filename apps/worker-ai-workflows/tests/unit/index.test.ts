import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Unit tests for the Worker entry point routing.
 * Mocks the serveMany router so we can assert health-check handling and that
 * all non-GET-/ requests are delegated to the workflow dispatcher.
 */

const { mockWorkflowsFetch } = vi.hoisted(() => ({
  mockWorkflowsFetch: vi.fn(),
}))

vi.mock("../../src/workflows", () => ({
  workflowsFetch: mockWorkflowsFetch,
}))

import worker from "../../src/index"

function makeRequest(method: string, path: string): Request {
  return new Request(`https://worker-ai-workflows.workers.dev${path}`, { method })
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (promise: Promise<unknown>) => {
      void promise
    },
    passThroughOnException: () => undefined,
    props: {},
  }
}

describe("worker fetch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowsFetch.mockResolvedValue(Response.json({ ok: true }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("responds to GET / health check without invoking a workflow", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {}, makeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(mockWorkflowsFetch).not.toHaveBeenCalled()
  })

  it("delegates POST /generate-weekly-outfits to the workflow router", async () => {
    const request = makeRequest("POST", "/generate-weekly-outfits")
    const env = {}
    await worker.fetch(request, env, makeCtx())
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, env)
  })

  it("delegates POST /generate-search-terms-products-scraping to the workflow router", async () => {
    const request = makeRequest("POST", "/generate-search-terms-products-scraping")
    await worker.fetch(request, {}, makeCtx())
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, {})
  })

  it("delegates POST /analyze-scraped-products-results to the workflow router", async () => {
    const request = makeRequest("POST", "/analyze-scraped-products-results")
    await worker.fetch(request, {}, makeCtx())
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, {})
  })

  it("returns 401 when the workflow router rejects an unsigned request", async () => {
    mockWorkflowsFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    const res = await worker.fetch(
      makeRequest("POST", "/generate-search-terms-products-scraping"),
      {},
      makeCtx(),
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 for an unsigned analyze request", async () => {
    mockWorkflowsFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    const res = await worker.fetch(
      makeRequest("POST", "/analyze-scraped-products-results"),
      {},
      makeCtx(),
    )
    expect(res.status).toBe(401)
  })

  it("delegates unknown non-GET paths to the workflow router", async () => {
    await worker.fetch(makeRequest("POST", "/unknown"), {}, makeCtx())
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
  })

  it("propagates errors thrown by the workflow router", async () => {
    mockWorkflowsFetch.mockRejectedValueOnce(new Error("boom"))
    await expect(
      worker.fetch(makeRequest("POST", "/generate-weekly-outfits"), {}, makeCtx()),
    ).rejects.toThrow("boom")
  })

  it("still returns 200 on GET / when Grafana OTLP export fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("otlp down")),
    )
    const pending: Array<Promise<unknown>> = []
    const ctx: ExecutionContext = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise)
      },
      passThroughOnException: () => undefined,
      props: {},
    }
    const res = await worker.fetch(
      makeRequest("GET", "/"),
      {
        OBSERVABILITY_PROVIDER: "grafana-cloud",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otlp.example/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic abc",
      },
      ctx,
    )
    expect(res.status).toBe(200)
    await Promise.all(pending)
  })
})
