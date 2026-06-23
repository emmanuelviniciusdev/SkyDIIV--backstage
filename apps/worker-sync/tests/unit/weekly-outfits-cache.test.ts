import { describe, it, expect, vi, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  deleteRedisKey: mocks.deleteRedisKey,
}))

import { deleteCachedWeeklyOutfits, getCurrentWeekStartDate } from "../../src/lib/cache/weekly-outfits-cache"

describe("deleteCachedWeeklyOutfits", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("deletes the weekly-outfits key for the user and week", async () => {
    mocks.deleteRedisKey.mockResolvedValue(true)

    const deleted = await deleteCachedWeeklyOutfits("user-123", "2026-06-07")

    expect(mocks.deleteRedisKey).toHaveBeenCalledWith("weekly-outfits:user-123:2026-06-07")
    expect(deleted).toBe(true)
  })
})

describe("getCurrentWeekStartDate", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns the Sunday UTC date for the current week", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-11T15:00:00.000Z"))

    expect(getCurrentWeekStartDate()).toBe("2026-06-07")
  })
})
