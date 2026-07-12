import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the catch-up-outbox-events schedule handler.
 */

const { mockVerify, mockRun } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockRun: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashReceiver: vi.fn(() => ({ verify: mockVerify })),
}))

vi.mock("../../src/flows/catch-up-outbox-events.flow", () => ({
  catchUpOutboxEventsFlow: {
    name: "catch-up-outbox-events",
    run: mockRun,
  },
}))

import { handleCatchUpOutboxEventsSchedule } from "../../src/handlers/catch-up-outbox-events.schedule"

const BASE_URL = "https://worker-scheduler.workers.dev/schedule/catch-up-outbox-events"

function makeRequest(signature: string | null, body = "{}"): Request {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (signature) headers.set("upstash-signature", signature)
  return new Request(BASE_URL, { method: "POST", headers, body })
}

describe("handleCatchUpOutboxEventsSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when upstash-signature header is missing", async () => {
    const res = await handleCatchUpOutboxEventsSchedule(makeRequest(null))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("returns 401 when QStash signature verification fails", async () => {
    mockVerify.mockRejectedValueOnce(new Error("bad signature"))
    const res = await handleCatchUpOutboxEventsSchedule(makeRequest("bad-sig"))
    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("returns 200 with flow result on success", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRun.mockResolvedValueOnce({ flow: "catch-up-outbox-events", dispatched: 3 })

    const res = await handleCatchUpOutboxEventsSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: "ok", flow: "catch-up-outbox-events", dispatched: 3 })
    expect(mockRun).toHaveBeenCalledOnce()
  })

  it("returns 200 with dispatched: 0 when no stale events", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRun.mockResolvedValueOnce({ flow: "catch-up-outbox-events", dispatched: 0 })

    const res = await handleCatchUpOutboxEventsSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dispatched).toBe(0)
  })

  it("returns 500 when the flow throws", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRun.mockRejectedValueOnce(new Error("DB connection failed"))

    const res = await handleCatchUpOutboxEventsSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({
      flow: "catch-up-outbox-events",
      status: "error",
      error: "Error: DB connection failed",
    })
  })
})
