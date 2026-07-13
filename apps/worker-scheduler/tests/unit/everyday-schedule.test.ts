import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the everyday schedule handler.
 * Mocks the QStash receiver and everyday flow registry to test orchestration
 * independently of any concrete flow.
 */

const { mockVerify, mockGetEverydayFlows, mockRunA, mockRunB } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockGetEverydayFlows: vi.fn(),
  mockRunA: vi.fn(),
  mockRunB: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashReceiver: vi.fn(() => ({ verify: mockVerify })),
}))

vi.mock("../../src/flows/everyday-registry", () => ({
  getEverydayFlows: mockGetEverydayFlows,
}))

import { handleEverydaySchedule } from "../../src/handlers/everyday.schedule"

const BASE_URL = "https://worker-scheduler.workers.dev/schedule/everyday"

function makeRequest(signature: string | null, body = "{}"): Request {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (signature) headers.set("upstash-signature", signature)
  return new Request(BASE_URL, { method: "POST", headers, body })
}

describe("handleEverydaySchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when upstash-signature header is missing", async () => {
    const res = await handleEverydaySchedule(makeRequest(null))
    expect(res.status).toBe(401)
    expect(mockGetEverydayFlows).not.toHaveBeenCalled()
  })

  it("returns 401 when QStash signature verification throws", async () => {
    mockVerify.mockRejectedValueOnce(new Error("bad signature"))
    const res = await handleEverydaySchedule(makeRequest("bad-sig"))
    expect(res.status).toBe(401)
  })

  it("returns 200 with empty flows array when no flows are configured", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockGetEverydayFlows.mockReturnValueOnce([])

    const res = await handleEverydaySchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.flows).toEqual([])
    expect(mockRunA).not.toHaveBeenCalled()
  })

  it("returns 200 and the flow result when one flow succeeds", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockResolvedValueOnce({
      flow: "neon-database-snapshot",
      deletedSnapshotIds: ["snap-old"],
      createdSnapshotId: "snap-new",
      createdSnapshotName: "skydiiv-daily-2026-07-13",
    })
    mockGetEverydayFlows.mockReturnValueOnce([{ name: "neon-database-snapshot", run: mockRunA }])

    const res = await handleEverydaySchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.flows).toHaveLength(1)
    expect(body.flows[0]).toMatchObject({
      flow: "neon-database-snapshot",
      status: "ok",
      createdSnapshotId: "snap-new",
    })
  })

  it("returns 500 when the only registered flow fails", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockRejectedValueOnce(new Error("Neon API unavailable"))
    mockGetEverydayFlows.mockReturnValueOnce([{ name: "neon-database-snapshot", run: mockRunA }])

    const res = await handleEverydaySchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.flows[0]).toMatchObject({
      flow: "neon-database-snapshot",
      status: "error",
    })
    expect(body.flows[0].error).toContain("Neon API unavailable")
  })

  it("returns 207 and runs both flows when one succeeds and one fails", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockResolvedValueOnce({ flow: "flow-a", ok: true })
    mockRunB.mockRejectedValueOnce(new Error("flow-b failed"))
    mockGetEverydayFlows.mockReturnValueOnce([
      { name: "flow-a", run: mockRunA },
      { name: "flow-b", run: mockRunB },
    ])

    const res = await handleEverydaySchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.flows).toHaveLength(2)
    expect(body.flows[0]).toMatchObject({ flow: "flow-a", status: "ok" })
    expect(body.flows[1]).toMatchObject({ flow: "flow-b", status: "error" })
    expect(mockRunA).toHaveBeenCalledOnce()
    expect(mockRunB).toHaveBeenCalledOnce()
  })

  it("does not let one flow failure abort the others", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockRunA.mockRejectedValueOnce(new Error("err-a"))
    mockRunB.mockResolvedValueOnce({ flow: "flow-b", ok: true })
    mockGetEverydayFlows.mockReturnValueOnce([
      { name: "flow-a", run: mockRunA },
      { name: "flow-b", run: mockRunB },
    ])

    await handleEverydaySchedule(makeRequest("valid-sig"))

    expect(mockRunA).toHaveBeenCalledOnce()
    expect(mockRunB).toHaveBeenCalledOnce()
  })
})
