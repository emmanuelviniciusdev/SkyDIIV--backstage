import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  invalidateCaches: vi.fn(),
}))

vi.mock("../../src/lib/cache/invalidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/cache/invalidation")>()
  return {
    ...actual,
    invalidateCaches: mocks.invalidateCaches,
  }
})

import { invalidateCacheStep } from "../../src/steps/invalidate-cache"
import { CACHE_TARGETS } from "../../src/lib/cache/invalidation"

describe("invalidateCacheStep", () => {
  beforeEach(() => {
    mocks.invalidateCaches.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("invalidates the requested cache targets for the user", async () => {
    mocks.invalidateCaches.mockResolvedValue([
      { target: CACHE_TARGETS.WEEKLY_OUTFITS, key: "weekly-outfits:user-1:2026-06-07", deleted: true },
    ])

    await invalidateCacheStep({
      userId: "user-1",
      targets: [CACHE_TARGETS.WEEKLY_OUTFITS],
    })

    expect(mocks.invalidateCaches).toHaveBeenCalledWith("user-1", [CACHE_TARGETS.WEEKLY_OUTFITS])
  })

  it("does not throw when cache invalidation fails", async () => {
    mocks.invalidateCaches.mockRejectedValue(new Error("Redis unavailable"))

    await expect(
      invalidateCacheStep({
        userId: "user-1",
        targets: [CACHE_TARGETS.WARDROBE_PANORAMA],
      }),
    ).resolves.toBeUndefined()
  })
})
