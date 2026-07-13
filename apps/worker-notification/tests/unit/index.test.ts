import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockWorkflowsFetch } = vi.hoisted(() => ({
  mockWorkflowsFetch: vi.fn(),
}))

vi.mock("../../src/workflows", () => ({
  workflowsFetch: mockWorkflowsFetch,
}))

import worker from "../../src/index"

function makeRequest(method: string, path: string): Request {
  return new Request(`https://worker-notification.workers.dev${path}`, { method })
}

describe("worker fetch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowsFetch.mockResolvedValue(Response.json({ ok: true }))
  })

  it("responds to GET / health check without invoking a workflow", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {})
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe("ok")
    expect(mockWorkflowsFetch).not.toHaveBeenCalled()
  })

  it("delegates POST /email--welcome to the workflow router", async () => {
    const request = makeRequest("POST", "/email--welcome")
    const env = {}
    await worker.fetch(request, env)
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(request, env)
  })

  it("delegates unknown non-GET paths to the workflow router", async () => {
    await worker.fetch(makeRequest("POST", "/unknown"), {})
    expect(mockWorkflowsFetch).toHaveBeenCalledOnce()
  })

  it("propagates errors thrown by the workflow router", async () => {
    mockWorkflowsFetch.mockRejectedValueOnce(new Error("boom"))
    await expect(worker.fetch(makeRequest("POST", "/email--welcome"), {})).rejects.toThrow(
      "boom",
    )
  })
})
