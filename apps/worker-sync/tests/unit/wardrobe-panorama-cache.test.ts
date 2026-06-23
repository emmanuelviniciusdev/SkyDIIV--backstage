import { describe, it, expect, vi, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  deleteRedisKey: mocks.deleteRedisKey,
}))

import { deleteCachedWardrobePanorama } from "../../src/lib/cache/wardrobe-panorama-cache"

describe("deleteCachedWardrobePanorama", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("deletes the wardrobe-panorama key for the user", async () => {
    mocks.deleteRedisKey.mockResolvedValue(true)

    const deleted = await deleteCachedWardrobePanorama("user-123")

    expect(mocks.deleteRedisKey).toHaveBeenCalledWith("wardrobe-panorama:user-123")
    expect(deleted).toBe(true)
  })
})
