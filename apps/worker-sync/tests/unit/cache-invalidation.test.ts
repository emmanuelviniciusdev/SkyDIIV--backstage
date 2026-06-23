import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteCachedWeeklyOutfits: vi.fn(),
  deleteCachedWardrobePanorama: vi.fn(),
  clearLanguageSyncRunning: vi.fn(),
  getCurrentWeekStartDate: vi.fn(),
}))

vi.mock("../../src/lib/cache/weekly-outfits-cache", () => ({
  deleteCachedWeeklyOutfits: mocks.deleteCachedWeeklyOutfits,
  getCurrentWeekStartDate: mocks.getCurrentWeekStartDate,
}))

vi.mock("../../src/lib/cache/wardrobe-panorama-cache", () => ({
  deleteCachedWardrobePanorama: mocks.deleteCachedWardrobePanorama,
}))

vi.mock("../../src/lib/cache/language-sync-cache", () => ({
  clearLanguageSyncRunning: mocks.clearLanguageSyncRunning,
}))

import { CACHE_TARGETS, invalidateCaches } from "../../src/lib/cache/invalidation"

describe("invalidateCaches", () => {
  beforeEach(() => {
    mocks.deleteCachedWeeklyOutfits.mockReset()
    mocks.deleteCachedWardrobePanorama.mockReset()
    mocks.clearLanguageSyncRunning.mockReset()
    mocks.getCurrentWeekStartDate.mockReset()
    mocks.getCurrentWeekStartDate.mockReturnValue("2026-06-07")
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("invalidates each requested cache target", async () => {
    mocks.clearLanguageSyncRunning.mockResolvedValue(true)
    mocks.deleteCachedWeeklyOutfits.mockResolvedValue(true)
    mocks.deleteCachedWardrobePanorama.mockResolvedValue(false)

    const results = await invalidateCaches("user-123", [
      CACHE_TARGETS.LANGUAGE_SYNC_RUNNING,
      CACHE_TARGETS.WEEKLY_OUTFITS,
      CACHE_TARGETS.WARDROBE_PANORAMA,
    ])

    expect(mocks.clearLanguageSyncRunning).toHaveBeenCalledWith("user-123")
    expect(mocks.deleteCachedWeeklyOutfits).toHaveBeenCalledWith("user-123", "2026-06-07")
    expect(mocks.deleteCachedWardrobePanorama).toHaveBeenCalledWith("user-123")
    expect(results).toEqual([
      { target: CACHE_TARGETS.LANGUAGE_SYNC_RUNNING, key: "running-sync-language:user-123", deleted: true },
      { target: CACHE_TARGETS.WEEKLY_OUTFITS, key: "weekly-outfits:user-123:2026-06-07", deleted: true },
      { target: CACHE_TARGETS.WARDROBE_PANORAMA, key: "wardrobe-panorama:user-123", deleted: false },
    ])
  })

  it("deduplicates repeated targets", async () => {
    mocks.deleteCachedWardrobePanorama.mockResolvedValue(true)

    await invalidateCaches("user-123", [
      CACHE_TARGETS.WARDROBE_PANORAMA,
      CACHE_TARGETS.WARDROBE_PANORAMA,
    ])

    expect(mocks.deleteCachedWardrobePanorama).toHaveBeenCalledTimes(1)
  })
})
