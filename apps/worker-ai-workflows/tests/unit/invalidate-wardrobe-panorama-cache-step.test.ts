import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  invalidateWardrobePanoramaCaches: vi.fn(),
}))

vi.mock("../../src/lib/cache/wardrobe-panorama-cache", () => ({
  invalidateWardrobePanoramaCaches: mocks.invalidateWardrobePanoramaCaches,
}))

import { invalidateWardrobePanoramaCacheStep } from "../../src/workflows/generate-wardrobe-panorama/steps/invalidate-wardrobe-panorama-cache"

describe("invalidateWardrobePanoramaCacheStep", () => {
  beforeEach(() => {
    mocks.invalidateWardrobePanoramaCaches.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("invalidates all wardrobe panorama cache keys for the user", async () => {
    mocks.invalidateWardrobePanoramaCaches.mockResolvedValue([
      { key: "wardrobe-update-check:user-1--wardrobe-panorama", deleted: true },
      { key: "wardrobe-panorama:user-1", deleted: true },
    ])

    await invalidateWardrobePanoramaCacheStep("user-1")

    expect(mocks.invalidateWardrobePanoramaCaches).toHaveBeenCalledWith("user-1")
  })

  it("does not throw when cache invalidation fails", async () => {
    mocks.invalidateWardrobePanoramaCaches.mockRejectedValue(new Error("Redis unavailable"))

    await expect(invalidateWardrobePanoramaCacheStep("user-1")).resolves.toBeUndefined()
  })
})
