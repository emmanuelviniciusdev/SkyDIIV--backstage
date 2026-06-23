import { describe, it, expect, vi, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  deleteRedisKey: mocks.deleteRedisKey,
}))

import { clearLanguageSyncRunning } from "../../src/lib/cache/language-sync-cache"

describe("clearLanguageSyncRunning", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("deletes the running-sync-language key for the user", async () => {
    mocks.deleteRedisKey.mockResolvedValue(true)

    const deleted = await clearLanguageSyncRunning("user-123")

    expect(mocks.deleteRedisKey).toHaveBeenCalledWith("running-sync-language:user-123")
    expect(deleted).toBe(true)
  })
})
