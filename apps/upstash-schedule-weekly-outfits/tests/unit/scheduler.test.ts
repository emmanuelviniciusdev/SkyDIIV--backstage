import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Unit tests for the scheduler handler.
 * Mocks the DB, QStash receiver, and dispatcher to test routing logic.
 */

// ── Use vi.hoisted so mocks are available when vi.mock factories run ──────────
const { mockVerify, mockFindUsers, mockDispatch } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindUsers: vi.fn(),
  mockDispatch: vi.fn(),
}))

vi.mock("../../src/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
  resetDbClient: vi.fn(),
}))

vi.mock("../../src/lib/db/users.repository", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SqlUsersRepository: vi.fn(function (this: any) {
    this.findUsersWithOutfitPreferences = mockFindUsers
  }),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashReceiver: vi.fn(() => ({ verify: mockVerify })),
  dispatchUsersToWorkflow: mockDispatch,
  resetQStashClients: vi.fn(),
}))

import { handleSchedule } from "../../src/scheduler"

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeRequest(signature: string | null, body = "{}"): Request {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (signature) headers.set("upstash-signature", signature)
  return new Request("https://weekly-outfits-scheduler.workers.dev/schedule", {
    method: "POST",
    headers,
    body,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("handleSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WEEKLY_OUTFITS_WORKER_URL = "https://weekly-outfits-worker.example.workers.dev"
    process.env.QSTASH_CURRENT_SIGNING_KEY = "test-current-key"
    process.env.QSTASH_NEXT_SIGNING_KEY = "test-next-key"
    process.env.DATABASE_URL = "postgresql://test"
  })

  afterEach(() => {
    delete process.env.WEEKLY_OUTFITS_WORKER_URL
    delete process.env.QSTASH_CURRENT_SIGNING_KEY
    delete process.env.QSTASH_NEXT_SIGNING_KEY
    delete process.env.DATABASE_URL
  })

  it("returns 401 when upstash-signature header is missing", async () => {
    const res = await handleSchedule(makeRequest(null))
    expect(res.status).toBe(401)
  })

  it("returns 401 when QStash signature verification throws", async () => {
    mockVerify.mockRejectedValueOnce(new Error("bad signature"))
    const res = await handleSchedule(makeRequest("bad-sig"))
    expect(res.status).toBe(401)
  })

  it("returns 401 when QStash verify returns false", async () => {
    mockVerify.mockResolvedValueOnce(false)
    const res = await handleSchedule(makeRequest("invalid-sig"))
    expect(res.status).toBe(401)
  })

  it("returns { dispatched: 0 } when no eligible users exist", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockFindUsers.mockResolvedValueOnce([])

    const res = await handleSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dispatched).toBe(0)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("queries users, dispatches them, and returns { dispatched: N }", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockFindUsers.mockResolvedValueOnce([{ userId: "uuid-1" }, { userId: "uuid-2" }])
    mockDispatch.mockResolvedValueOnce(2)

    const res = await handleSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dispatched).toBe(2)
    expect(mockDispatch).toHaveBeenCalledWith([{ userId: "uuid-1" }, { userId: "uuid-2" }])
  })

  it("returns 500 when DB query throws", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockFindUsers.mockRejectedValueOnce(new Error("DB connection failed"))

    const res = await handleSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("eligible users")
  })

  it("returns 500 when QStash dispatch throws", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockFindUsers.mockResolvedValueOnce([{ userId: "uuid-1" }])
    mockDispatch.mockRejectedValueOnce(new Error("QStash unavailable"))

    const res = await handleSchedule(makeRequest("valid-sig"))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("dispatch")
  })
})
