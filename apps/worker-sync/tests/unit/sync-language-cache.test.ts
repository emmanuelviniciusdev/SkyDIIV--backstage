import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  deleteRedisKey: mocks.deleteRedisKey,
}))

import { deleteCachedRunningSyncLanguage } from "../../src/lib/cache/sync-language-cache"

describe("deleteCachedRunningSyncLanguage", () => {
  beforeEach(() => {
    mocks.deleteRedisKey.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("deletes the running-sync-language key for the user", async () => {
    mocks.deleteRedisKey.mockResolvedValue(true)

    const deleted = await deleteCachedRunningSyncLanguage("user-123")

    expect(mocks.deleteRedisKey).toHaveBeenCalledWith("running-sync-language:user-123")
    expect(deleted).toBe(true)
  })
})
