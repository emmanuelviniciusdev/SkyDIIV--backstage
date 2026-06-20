import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFindUsers, mockFilterUsers, mockBatchJSON } = vi.hoisted(() => ({
  mockFindUsers: vi.fn(),
  mockFilterUsers: vi.fn(),
  mockBatchJSON: vi.fn(),
}))

vi.mock("../../src/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
  resetDbClient: vi.fn(),
}))

vi.mock("../../src/lib/db/users.repository", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SqlUsersRepository: vi.fn(function (this: any) {
    this.findUsersWithWardrobeSizeAtLeast = mockFindUsers
  }),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashClient: vi.fn(() => ({ batchJSON: mockBatchJSON })),
}))

vi.mock("../../src/lib/cache/wardrobe-panorama-cache", () => ({
  filterUsersWithWardrobeUpdateCheck: mockFilterUsers,
}))

import { generateWardrobePanoramaFlow } from "../../src/flows/generate-wardrobe-panorama.flow"

describe("generateWardrobePanoramaFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WARDROBE_PANORAMA_WORKER_URL = "https://worker-ai-workflows.example.workers.dev/generate-wardrobe-panorama"
    mockFilterUsers.mockImplementation(async (users) => users)
  })

  it("is named generate-wardrobe-panorama", () => {
    expect(generateWardrobePanoramaFlow.name).toBe("generate-wardrobe-panorama")
  })

  it("returns dispatched: 0 and does not dispatch when no eligible users", async () => {
    mockFindUsers.mockResolvedValueOnce([])

    const result = await generateWardrobePanoramaFlow.run()

    expect(result).toEqual({ flow: "generate-wardrobe-panorama", dispatched: 0 })
    expect(mockFilterUsers).not.toHaveBeenCalled()
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("returns dispatched: 0 when no users have the wardrobe update marker", async () => {
    mockFindUsers.mockResolvedValueOnce([{ userId: "uuid-1" }, { userId: "uuid-2" }])
    mockFilterUsers.mockResolvedValueOnce([])

    const result = await generateWardrobePanoramaFlow.run()

    expect(result).toEqual({ flow: "generate-wardrobe-panorama", dispatched: 0 })
    expect(mockFilterUsers).toHaveBeenCalledWith([{ userId: "uuid-1" }, { userId: "uuid-2" }])
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("dispatches only users with the wardrobe update marker", async () => {
    const eligibleUsers = [{ userId: "uuid-1" }, { userId: "uuid-2" }]
    mockFindUsers.mockResolvedValueOnce(eligibleUsers)
    mockFilterUsers.mockResolvedValueOnce([{ userId: "uuid-2" }])
    mockBatchJSON.mockResolvedValueOnce([])

    const result = await generateWardrobePanoramaFlow.run()

    expect(result).toEqual({ flow: "generate-wardrobe-panorama", dispatched: 1 })
    expect(mockFilterUsers).toHaveBeenCalledWith(eligibleUsers)
    expect(mockBatchJSON).toHaveBeenCalledOnce()
  })

  it("propagates errors from the user query", async () => {
    mockFindUsers.mockRejectedValueOnce(new Error("DB connection failed"))

    await expect(generateWardrobePanoramaFlow.run()).rejects.toThrow("DB connection failed")
  })
})
