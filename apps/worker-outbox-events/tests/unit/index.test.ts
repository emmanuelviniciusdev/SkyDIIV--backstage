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
    mockWorkflowsFetch.mockResolvedValue(Response.json({ processed: true }))
  })

  it("responds to GET / health check without invoking workflows", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {}, makeCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.timestamp).toBeDefined()
    expect(mockWorkflowsFetch).not.toHaveBeenCalled()
  })

  it("delegates non-health requests to workflowsFetch", async () => {
    const req = makeRequest("POST", "/process-outbox-event")
    const env = { WORKER_OUTBOX_EVENTS_URL: "https://example.workers.dev" }
    await worker.fetch(req, env, makeCtx())
    expect(mockWorkflowsFetch).toHaveBeenCalledWith(req, env)
  })

  it("returns 401 for an unsigned process-outbox-event request", async () => {
    mockWorkflowsFetch.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
    const res = await worker.fetch(makeRequest("POST", "/process-outbox-event"), {}, makeCtx())
    expect(res.status).toBe(401)
  })

  it("rethrows unhandled workflow errors", async () => {
    mockWorkflowsFetch.mockRejectedValueOnce(new Error("workflow failed"))
    await expect(
      worker.fetch(makeRequest("POST", "/process-outbox-event"), {}, makeCtx()),
    ).rejects.toThrow("workflow failed")
  })
})
