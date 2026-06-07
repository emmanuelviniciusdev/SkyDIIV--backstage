import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { EligibleUser } from "../../src/lib/db/users.repository"

/**
 * Unit tests for dispatchUsersToWorkflow.
 * Mocks @upstash/qstash Client to verify batching logic without network calls.
 */

// ── Mock @upstash/qstash at the package level ─────────────────────────────────
const mockBatchJSON = vi.hoisted(() => vi.fn())

vi.mock("@upstash/qstash", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Client: vi.fn(function (this: any) { this.batchJSON = mockBatchJSON }),
  Receiver: vi.fn(function () {}),
}))

import { dispatchUsersToWorkflow, resetQStashClients } from "../../src/lib/qstash"

describe("dispatchUsersToWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQStashClients()
    process.env.WEEKLY_OUTFITS_WORKER_URL = "https://worker.example.com"
    process.env.QSTASH_TOKEN = "test-token"
  })

  afterEach(() => {
    delete process.env.WEEKLY_OUTFITS_WORKER_URL
    delete process.env.QSTASH_TOKEN
  })

  it("returns 0 and does not call QStash for empty input", async () => {
    const result = await dispatchUsersToWorkflow([])
    expect(result).toBe(0)
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("dispatches a single batch for a small user list", async () => {
    mockBatchJSON.mockResolvedValue([])
    const users: EligibleUser[] = [{ userId: "a" }, { userId: "b" }]

    const result = await dispatchUsersToWorkflow(users)

    expect(result).toBe(2)
    expect(mockBatchJSON).toHaveBeenCalledTimes(1)

    const [messages] = mockBatchJSON.mock.calls[0] as [Array<{ url: string; body: { userId: string } }>]
    expect(messages).toHaveLength(2)
    expect(messages[0]!.body).toEqual({ userId: "a" })
    expect(messages[0]!.url).toBe("https://worker.example.com")
  })

  it("throws when WEEKLY_OUTFITS_WORKER_URL is not set", async () => {
    delete process.env.WEEKLY_OUTFITS_WORKER_URL
    const users: EligibleUser[] = [{ userId: "a" }]

    await expect(dispatchUsersToWorkflow(users)).rejects.toThrow("WEEKLY_OUTFITS_WORKER_URL")
  })

  it("sends correct Content-Type header for each message", async () => {
    mockBatchJSON.mockResolvedValue([])
    const users: EligibleUser[] = [{ userId: "user-123" }]

    await dispatchUsersToWorkflow(users)

    const [messages] = mockBatchJSON.mock.calls[0] as [Array<{ headers: Record<string, string> }>]
    expect(messages[0]!.headers["Content-Type"]).toBe("application/json")
  })
})
