import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the Worker entry point routing.
 * Mocks the schedule handler to assert each weekday endpoint maps to the
 * correct Weekday, plus the health check and 404 behaviour.
 */

const { mockHandleSchedule } = vi.hoisted(() => ({
  mockHandleSchedule: vi.fn(),
}))

vi.mock("../../src/scheduler", () => ({
  handleSchedule: mockHandleSchedule,
}))

import worker from "../../src/index"

function makeRequest(method: string, path: string): Request {
  return new Request(`https://worker-scheduler.workers.dev${path}`, { method })
}

describe("worker fetch routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandleSchedule.mockResolvedValue(Response.json({ ok: true }))
  })

  it("responds to GET / health check without invoking a flow", async () => {
    const res = await worker.fetch(makeRequest("GET", "/"), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(mockHandleSchedule).not.toHaveBeenCalled()
  })

  it.each([
    ["/schedule/every-monday", "monday"],
    ["/schedule/every-tuesday", "tuesday"],
    ["/schedule/every-wednesday", "wednesday"],
    ["/schedule/every-thursday", "thursday"],
    ["/schedule/every-friday", "friday"],
    ["/schedule/every-saturday", "saturday"],
    ["/schedule/every-sunday", "sunday"],
  ])("routes POST %s to handleSchedule with day %s", async (path, day) => {
    await worker.fetch(makeRequest("POST", path), {})
    expect(mockHandleSchedule).toHaveBeenCalledOnce()
    expect(mockHandleSchedule.mock.calls[0]![1]).toBe(day)
  })

  it("returns 404 for an unknown path", async () => {
    const res = await worker.fetch(makeRequest("POST", "/schedule/every-someday"), {})
    expect(res.status).toBe(404)
    expect(mockHandleSchedule).not.toHaveBeenCalled()
  })

  it("returns 404 for GET on a schedule endpoint", async () => {
    const res = await worker.fetch(makeRequest("GET", "/schedule/every-sunday"), {})
    expect(res.status).toBe(404)
    expect(mockHandleSchedule).not.toHaveBeenCalled()
  })
})
