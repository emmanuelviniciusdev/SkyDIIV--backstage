import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  hasWardrobeUpdateCheck,
  invalidateWardrobePanoramaCaches,
} from "../../src/lib/cache/wardrobe-panorama-cache"

describe("hasWardrobeUpdateCheck", () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    process.env = {
      ...originalEnv,
      UPSTASH_REDIS_REST_URL: "https://us1-example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "rest-token",
    }
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 1 }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    fetchMock.mockReset()
  })

  it("checks the same cache key used by the skydiiv web app", async () => {
    await hasWardrobeUpdateCheck("user-123")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/exists/wardrobe-update-check%3Auser-123--wardrobe-panorama",
      expect.any(Object),
    )
  })
})

describe("invalidateWardrobePanoramaCaches", () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    process.env = {
      ...originalEnv,
      UPSTASH_REDIS_REST_URL: "https://us1-example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "rest-token",
    }
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 1 }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    fetchMock.mockReset()
  })

  it("deletes all wardrobe-panorama-related cache keys used by the skydiiv web app", async () => {
    const results = await invalidateWardrobePanoramaCaches("user-123")

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://us1-example.upstash.io/del/wardrobe-update-check%3Auser-123--wardrobe-panorama",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://us1-example.upstash.io/del/wardrobe-panorama%3Auser-123",
      expect.objectContaining({ method: "POST" }),
    )
    expect(results).toEqual([
      { key: "wardrobe-update-check:user-123--wardrobe-panorama", deleted: true },
      { key: "wardrobe-panorama:user-123", deleted: true },
    ])
  })
})
