import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockWorkflowsFetch } = vi.hoisted(() => ({
  mockWorkflowsFetch: vi.fn(),
}))

vi.mock("../../src/workflows", () => ({
  workflowsFetch: mockWorkflowsFetch,
}))

import worker from "../../src/index"

function makeRequest(method: string, path: string): Request {
  return new Request(`https://worker-outbox-events.workers.dev${path}`, { method })
}

describe("worker fetch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowsFetch.mockResolvedValue(Response.json({ processed: true }))
  })

  it("responds to GET / health check without invoking workflows", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.timestamp).toBeDefined()
    expect(mockWorkflowsFetch).not.toHaveBeenCalled()
  })

  it("delegates non-health requests to workflowsFetch", async () => {
    const req = makeRequest("POST", "/process-outbox-event")
    await worker.fetch(req, { WORKER_OUTBOX_EVENTS_URL: "https://example.workers.dev" })
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(req, {
      WORKER_OUTBOX_EVENTS_URL: "https://example.workers.dev",
    })
  })

  it("rethrows unhandled workflow errors", async () => {
    mockWorkflowsFetch.mockRejectedValueOnce(new Error("workflow failed"))
    await expect(
      worker.fetch(makeRequest("POST", "/process-outbox-event"), {}),
    ).rejects.toThrow("workflow failed")
  })
})
