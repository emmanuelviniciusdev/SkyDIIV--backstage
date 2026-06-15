import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the central schedule handler.
 * Mocks the QStash receiver and flow registry to test orchestration logic
 * independently of any concrete flow.
 */

const { mockVerify, mockGetFlowsForDay, mockRunA, mockRunB } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockGetFlowsForDay: vi.fn(),
  mockRunA: vi.fn(),
  mockRunB: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashReceiver: vi.fn(() => ({ verify: mockVerify })),
}))

vi.mock("../../src/flows/registry", () => ({
  getFlowsForDay: mockGetFlowsForDay,
}))

import { handleSchedule } from "../../src/scheduler"
import type { Weekday } from "../../src/flows/types"

function makeRequest(signature: string | null, day: Weekday = "sunday", body = "{}"): Request {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (signature) headers.set("upstash-signature", signature)
  return new Request(`https://worker-scheduler.workers.dev/schedule/every-${day}`, {
    method: "POST",
    headers,
    body,
  })
}

describe("handleSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Auth ───────────────────────────────────────────────────────────────────

  it("returns 401 when upstash-signature header is missing", async () => {
    const res = await handleSchedule(makeRequest(null), "sunday")
    expect(res.status).toBe(401)
    expect(mockGetFlowsForDay).not.toHaveBeenCalled()
  })

  it("returns 401 when QStash signature verification throws", async () => {
    mockVerify.mockRejectedValueOnce(new Error("bad signature"))
    const res = await handleSchedule(makeRequest("bad-sig"), "sunday")
    expect(res.status).toBe(401)
  })

  it("returns 401 when QStash verify returns false", async () => {
    mockVerify.mockResolvedValueOnce(false)
    const res = await handleSchedule(makeRequest("invalid-sig"), "sunday")
    expect(res.status).toBe(401)
  })

  // ── No flows ───────────────────────────────────────────────────────────────

  it("returns 200 with empty flows array when no flows are configured for the day", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockGetFlowsForDay.mockReturnValueOnce([])

    const res = await handleSchedule(makeRequest("valid-sig", "monday"), "monday")

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.day).toBe("monday")
    expect(body.flows).toEqual([])
    expect(mockRunA).not.toHaveBeenCalled()
  })

  it("resolves flows for the day passed by the router", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockGetFlowsForDay.mockReturnValueOnce([])

    await handleSchedule(makeRequest("valid-sig", "wednesday"), "wednesday")

    expect(mockGetFlowsForDay).toHaveBeenCalledWith("wednesday")
  })

  // ── Single flow ────────────────────────────────────────────────────────────

  it("returns 200 and the flow result when one flow succeeds", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockResolvedValueOnce({ flow: "weekly-outfits", dispatched: 3 })
    mockGetFlowsForDay.mockReturnValueOnce([{ name: "weekly-outfits", run: mockRunA }])

    const res = await handleSchedule(makeRequest("valid-sig", "sunday"), "sunday")

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.day).toBe("sunday")
    expect(body.flows).toHaveLength(1)
    expect(body.flows[0]).toMatchObject({ flow: "weekly-outfits", status: "ok", dispatched: 3 })
  })

  it("returns 500 when the only registered flow fails", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockRejectedValueOnce(new Error("boom"))
    mockGetFlowsForDay.mockReturnValueOnce([{ name: "weekly-outfits", run: mockRunA }])

    const res = await handleSchedule(makeRequest("valid-sig", "sunday"), "sunday")

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.flows[0]).toMatchObject({ flow: "weekly-outfits", status: "error" })
    expect(body.flows[0].error).toContain("boom")
  })

  // ── Multiple flows ─────────────────────────────────────────────────────────

  it("returns 200 and both results when two flows both succeed", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockResolvedValueOnce({ flow: "flow-a", dispatched: 1 })
    mockRunB.mockResolvedValueOnce({ flow: "flow-b", processed: 4 })
    mockGetFlowsForDay.mockReturnValueOnce([
      { name: "flow-a", run: mockRunA },
      { name: "flow-b", run: mockRunB },
    ])

    const res = await handleSchedule(makeRequest("valid-sig", "sunday"), "sunday")

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.flows).toHaveLength(2)
    expect(body.flows[0]).toMatchObject({ flow: "flow-a", status: "ok", dispatched: 1 })
    expect(body.flows[1]).toMatchObject({ flow: "flow-b", status: "ok", processed: 4 })
  })

  it("returns 207 and runs both flows when one succeeds and one fails", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockResolvedValueOnce({ flow: "flow-a", dispatched: 2 })
    mockRunB.mockRejectedValueOnce(new Error("flow-b failed"))
    mockGetFlowsForDay.mockReturnValueOnce([
      { name: "flow-a", run: mockRunA },
      { name: "flow-b", run: mockRunB },
    ])

    const res = await handleSchedule(makeRequest("valid-sig", "sunday"), "sunday")

    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.flows).toHaveLength(2)
    expect(body.flows[0]).toMatchObject({ flow: "flow-a", status: "ok" })
    expect(body.flows[1]).toMatchObject({ flow: "flow-b", status: "error" })
    expect(mockRunA).toHaveBeenCalledOnce()
    expect(mockRunB).toHaveBeenCalledOnce()
  })

  it("returns 500 and reports both errors when all flows fail", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockRejectedValueOnce(new Error("err-a"))
    mockRunB.mockRejectedValueOnce(new Error("err-b"))
    mockGetFlowsForDay.mockReturnValueOnce([
      { name: "flow-a", run: mockRunA },
      { name: "flow-b", run: mockRunB },
    ])

    const res = await handleSchedule(makeRequest("valid-sig", "sunday"), "sunday")

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.flows[0]).toMatchObject({ flow: "flow-a", status: "error" })
    expect(body.flows[1]).toMatchObject({ flow: "flow-b", status: "error" })
  })

  it("does not let one flow failure abort the others", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockRejectedValueOnce(new Error("err-a"))
    mockRunB.mockResolvedValueOnce({ flow: "flow-b", ok: true })
    mockGetFlowsForDay.mockReturnValueOnce([
      { name: "flow-a", run: mockRunA },
      { name: "flow-b", run: mockRunB },
    ])

    await handleSchedule(makeRequest("valid-sig", "sunday"), "sunday")

    expect(mockRunA).toHaveBeenCalledOnce()
    expect(mockRunB).toHaveBeenCalledOnce()
  })
})
