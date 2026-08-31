import { describe, it, expect, vi, beforeEach } from "vitest"

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

describe("worker fetch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowsFetch.mockResolvedValue(Response.json({ ok: true }))
  })

  it("responds to GET / health check without invoking a workflow", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(mockWorkflowsFetch).not.toHaveBeenCalled()
  })

  it("delegates POST /generate-weekly-outfits to the workflow router", async () => {
    const request = makeRequest("POST", "/generate-weekly-outfits")
    const env = {}
    await worker.fetch(request, env)
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, env)
  })

  it("delegates POST /generate-search-terms-products-scraping to the workflow router", async () => {
    const request = makeRequest("POST", "/generate-search-terms-products-scraping")
    await worker.fetch(request, {})
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, {})
  })

  it("delegates POST /analyze-scraped-products-results to the workflow router", async () => {
    const request = makeRequest("POST", "/analyze-scraped-products-results")
    await worker.fetch(request, {})
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, {})
  })

  it("returns 401 when the workflow router rejects an unsigned request", async () => {
    mockWorkflowsFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    const res = await worker.fetch(
      makeRequest("POST", "/generate-search-terms-products-scraping"),
      {},
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 for an unsigned analyze request", async () => {
    mockWorkflowsFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    const res = await worker.fetch(
      makeRequest("POST", "/analyze-scraped-products-results"),
      {},
    )
    expect(res.status).toBe(401)
  })

  it("delegates unknown non-GET paths to the workflow router", async () => {
    await worker.fetch(makeRequest("POST", "/unknown"), {})
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
  })

  it("propagates errors thrown by the workflow router", async () => {
    mockWorkflowsFetch.mockRejectedValueOnce(new Error("boom"))
    await expect(worker.fetch(makeRequest("POST", "/generate-weekly-outfits"), {})).rejects.toThrow(
      "boom",
    )
  })
})
