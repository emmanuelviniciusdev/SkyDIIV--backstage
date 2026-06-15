import { describe, it, expect, vi, beforeEach } from "vitest"

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
    this.findUsersWithWardrobeSizeAtLeast = mockFindUsers
  }),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashClient: vi.fn(() => ({ batchJSON: mockBatchJSON })),
}))

import { generateWardrobePanoramaFlow } from "../../src/flows/generate-wardrobe-panorama.flow"

describe("generateWardrobePanoramaFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WARDROBE_PANORAMA_WORKER_URL = "https://worker-ai-workflows.example.workers.dev/generate-wardrobe-panorama"
  })

  it("is named generate-wardrobe-panorama", () => {
    expect(generateWardrobePanoramaFlow.name).toBe("generate-wardrobe-panorama")
  })

  it("returns dispatched: 0 and does not dispatch when no eligible users", async () => {
    mockFindUsers.mockResolvedValueOnce([])

    const result = await generateWardrobePanoramaFlow.run()

    expect(result).toEqual({ flow: "generate-wardrobe-panorama", dispatched: 0 })
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("dispatches eligible users and reports the count", async () => {
    mockFindUsers.mockResolvedValueOnce([{ userId: "uuid-1" }, { userId: "uuid-2" }])
    mockBatchJSON.mockResolvedValueOnce([])

    const result = await generateWardrobePanoramaFlow.run()

    expect(result).toEqual({ flow: "generate-wardrobe-panorama", dispatched: 2 })
    expect(mockBatchJSON).toHaveBeenCalledOnce()
  })

  it("propagates errors from the user query", async () => {
    mockFindUsers.mockRejectedValueOnce(new Error("DB connection failed"))

    await expect(generateWardrobePanoramaFlow.run()).rejects.toThrow("DB connection failed")
  })
})
