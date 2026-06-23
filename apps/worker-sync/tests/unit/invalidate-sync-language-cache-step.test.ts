import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteCachedRunningSyncLanguage: vi.fn(),
}))

vi.mock("../../src/lib/cache/sync-language-cache", () => ({
  deleteCachedRunningSyncLanguage: mocks.deleteCachedRunningSyncLanguage,
}))

import { invalidateSyncLanguageCacheStep } from "../../src/workflows/sync-language/steps/invalidate-sync-language-cache"

describe("invalidateSyncLanguageCacheStep", () => {
  beforeEach(() => {
    mocks.deleteCachedRunningSyncLanguage.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("invalidates the running-sync-language cache for the user", async () => {
    mocks.deleteCachedRunningSyncLanguage.mockResolvedValue(true)

    await invalidateSyncLanguageCacheStep("user-1")

    expect(mocks.deleteCachedRunningSyncLanguage).toHaveBeenCalledWith("user-1")
  })

  it("does not throw when cache invalidation fails", async () => {
    mocks.deleteCachedRunningSyncLanguage.mockRejectedValue(new Error("Redis unavailable"))

    await expect(invalidateSyncLanguageCacheStep("user-1")).resolves.toBeUndefined()
  })
})
