import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the Worker entry point routing.
 * Mocks the process-outbox-event handler to assert route mapping,
 * the health check, and 404 behaviour.
 */

const { mockHandleProcessOutboxEvent } = vi.hoisted(() => ({
  mockHandleProcessOutboxEvent: vi.fn(),
}))

vi.mock("../../src/handlers/process-outbox-event", () => ({
  handleProcessOutboxEvent: mockHandleProcessOutboxEvent,
}))

import worker from "../../src/index"

function makeRequest(method: string, path: string): Request {
  return new Request(`https://worker-outbox-events.workers.dev${path}`, { method })
}

describe("worker fetch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleProcessOutboxEvent.mockResolvedValue(Response.json({ processed: true }))
  })

  it("responds to GET / health check without invoking the handler", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.timestamp).toBeDefined()
    expect(mockHandleProcessOutboxEvent).not.toHaveBeenCalled()
  })

  it("routes POST /process-outbox-event to the handler", async () => {
    await worker.fetch(makeRequest("POST", "/process-outbox-event"), {})
    expect(mockHandleProcessOutboxEvent).toHaveBeenCalledOnce()
  })

  it("passes the request object to the handler", async () => {
    const req = makeRequest("POST", "/process-outbox-event")
    await worker.fetch(req, {})
    expect(mockHandleProcessOutboxEvent).toHaveBeenCalledWith(req)
  })

  it("returns 404 for an unknown POST path", async () => {
    const res = await worker.fetch(makeRequest("POST", "/unknown-endpoint"), {})
    expect(res.status).toBe(404)
    expect(mockHandleProcessOutboxEvent).not.toHaveBeenCalled()
  })

  it("returns 404 for GET on the process-outbox-event endpoint", async () => {
    const res = await worker.fetch(makeRequest("GET", "/process-outbox-event"), {})
    expect(res.status).toBe(404)
    expect(mockHandleProcessOutboxEvent).not.toHaveBeenCalled()
  })

  it("returns 404 for an unrelated path", async () => {
    const res = await worker.fetch(makeRequest("GET", "/healthz"), {})
    expect(res.status).toBe(404)
  })
})
