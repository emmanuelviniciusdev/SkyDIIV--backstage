import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  filterUsersWithWardrobeUpdateCheck,
  hasWardrobeUpdateCheck,
} from "../../src/lib/cache/wardrobe-panorama-cache"

const mocks = vi.hoisted(() => ({
  existsRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  existsRedisKey: mocks.existsRedisKey,
}))

describe("hasWardrobeUpdateCheck", () => {
  beforeEach(() => {
    mocks.existsRedisKey.mockReset()
  })

  it("checks the wardrobe-update-check cache key used by the skydiiv web app", async () => {
    mocks.existsRedisKey.mockResolvedValue(true)

    await expect(hasWardrobeUpdateCheck("user-123")).resolves.toBe(true)
    expect(mocks.existsRedisKey).toHaveBeenCalledWith("wardrobe-update-check:user-123--wardrobe-panorama")
  })
})

describe("filterUsersWithWardrobeUpdateCheck", () => {
  beforeEach(() => {
    mocks.existsRedisKey.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns an empty array for empty input", async () => {
    await expect(filterUsersWithWardrobeUpdateCheck([])).resolves.toEqual([])
    expect(mocks.existsRedisKey).not.toHaveBeenCalled()
  })

  it("keeps only users whose wardrobe update marker exists", async () => {
    mocks.existsRedisKey.mockImplementation(async (key: string) =>
      key === "wardrobe-update-check:user-2--wardrobe-panorama",
    )

    const users = [{ userId: "user-1" }, { userId: "user-2" }, { userId: "user-3" }]
    await expect(filterUsersWithWardrobeUpdateCheck(users)).resolves.toEqual([{ userId: "user-2" }])
  })
})
