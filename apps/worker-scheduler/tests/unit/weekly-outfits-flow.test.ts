import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the weekly-outfits flow's run() orchestration.
 * Mocks the DB, repository, and dispatcher; dispatch batching itself is
 * covered separately in dispatch.test.ts.
 */

const { mockFindUsers, mockBatchJSON } = vi.hoisted(() => ({
  mockFindUsers: vi.fn(),
  mockBatchJSON: vi.fn(),
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
  getQStashClient: vi.fn(() => ({ batchJSON: mockBatchJSON })),
}))

import { weeklyOutfitsFlow } from "../../src/flows/weekly-outfits.flow"

describe("weeklyOutfitsFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WEEKLY_OUTFITS_WORKER_URL = "https://weekly-outfits-worker.example.workers.dev"
  })

  it("is named weekly-outfits", () => {
    expect(weeklyOutfitsFlow.name).toBe("weekly-outfits")
  })

  it("returns dispatched: 0 and does not dispatch when no eligible users", async () => {
    mockFindUsers.mockResolvedValueOnce([])

    const result = await weeklyOutfitsFlow.run()

    expect(result).toEqual({ flow: "weekly-outfits", dispatched: 0 })
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("dispatches eligible users and reports the count", async () => {
    mockFindUsers.mockResolvedValueOnce([{ userId: "uuid-1" }, { userId: "uuid-2" }])
    mockBatchJSON.mockResolvedValueOnce([])

    const result = await weeklyOutfitsFlow.run()

    expect(result).toEqual({ flow: "weekly-outfits", dispatched: 2 })
    expect(mockBatchJSON).toHaveBeenCalledOnce()
  })

  it("propagates errors from the user query", async () => {
    mockFindUsers.mockRejectedValueOnce(new Error("DB connection failed"))

    await expect(weeklyOutfitsFlow.run()).rejects.toThrow("DB connection failed")
  })
})
