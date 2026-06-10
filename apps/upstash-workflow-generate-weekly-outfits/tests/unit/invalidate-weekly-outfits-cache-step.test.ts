import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteCachedWeeklyOutfits: vi.fn(),
}))

vi.mock("../../src/lib/cache/weekly-outfits-cache", () => ({
  deleteCachedWeeklyOutfits: mocks.deleteCachedWeeklyOutfits,
}))

import { invalidateWeeklyOutfitsCacheStep } from "../../src/steps/invalidate-weekly-outfits-cache"

describe("invalidateWeeklyOutfitsCacheStep", () => {
  beforeEach(() => {
    mocks.deleteCachedWeeklyOutfits.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("deletes the weekly outfits cache for the user and week", async () => {
    mocks.deleteCachedWeeklyOutfits.mockResolvedValue(true)

    await invalidateWeeklyOutfitsCacheStep({
      userId: "user-1",
      weekStartDate: "2026-06-07",
    })

    expect(mocks.deleteCachedWeeklyOutfits).toHaveBeenCalledWith("user-1", "2026-06-07")
  })

  it("does not throw when cache invalidation fails", async () => {
    mocks.deleteCachedWeeklyOutfits.mockRejectedValue(new Error("Redis unavailable"))

    await expect(
      invalidateWeeklyOutfitsCacheStep({
        userId: "user-1",
        weekStartDate: "2026-06-07",
      }),
    ).resolves.toBeUndefined()
  })
})
