import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  parseUpstashRestFromRedisUrl,
  getUpstashRestCredentials,
  existsRedisKey,
  deleteRedisKey,
} from "../../src/lib/cache/redis"
import { deleteCachedWeeklyOutfits } from "../../src/lib/cache/weekly-outfits-cache"

describe("parseUpstashRestFromRedisUrl", () => {
  it("parses a standard Upstash Redis URL", () => {
    const result = parseUpstashRestFromRedisUrl(
      "rediss://default:my-token@us1-example.upstash.io:6379",
    )

    expect(result).toEqual({
      url: "https://us1-example.upstash.io",
      token: "my-token",
    })
  })

  it("returns null for non-Upstash URLs", () => {
    expect(parseUpstashRestFromRedisUrl("redis://localhost:6379")).toBeNull()
  })

  it("returns null when the URL has no password token", () => {
    expect(parseUpstashRestFromRedisUrl("rediss://default@us1-example.upstash.io:6379")).toBeNull()
  })
})

describe("getUpstashRestCredentials", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("prefers explicit REST credentials", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://us1-example.upstash.io/"
    process.env.UPSTASH_REDIS_REST_TOKEN = "rest-token"
    process.env.REDIS_URL = "rediss://default:ignored@us1-other.upstash.io:6379"

    expect(getUpstashRestCredentials()).toEqual({
      url: "https://us1-example.upstash.io",
      token: "rest-token",
    })
  })

  it("falls back to REDIS_URL when REST vars are missing", () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.REDIS_URL = "rediss://default:from-redis-url@us1-example.upstash.io:6379"

    expect(getUpstashRestCredentials()).toEqual({
      url: "https://us1-example.upstash.io",
      token: "from-redis-url",
    })
  })

  it("returns null when no Redis configuration is present", () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.REDIS_URL

    expect(getUpstashRestCredentials()).toBeNull()
  })
})

describe("existsRedisKey", () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    process.env = {
      ...originalEnv,
      UPSTASH_REDIS_REST_URL: "https://us1-example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "rest-token",
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    fetchMock.mockReset()
  })

  it("returns true when Redis reports the key exists", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 1 }),
    })

    await expect(existsRedisKey("wardrobe-update-check:user-1--wardrobe-panorama")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/exists/wardrobe-update-check%3Auser-1--wardrobe-panorama",
      {
        headers: { Authorization: "Bearer rest-token" },
      },
    )
  })

  it("returns false when Redis reports the key is missing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 0 }),
    })

    await expect(existsRedisKey("wardrobe-update-check:user-1--wardrobe-panorama")).resolves.toBe(false)
  })

  it("returns false when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.REDIS_URL

    await expect(existsRedisKey("some-key")).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws when the REST API returns an error status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })

    await expect(existsRedisKey("some-key")).rejects.toThrow("Redis EXISTS failed (503)")
  })
})

describe("deleteRedisKey", () => {
  const originalEnv = { ...process.env }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
    process.env = {
      ...originalEnv,
      UPSTASH_REDIS_REST_URL: "https://us1-example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "rest-token",
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    fetchMock.mockReset()
  })

  it("returns true when Redis deletes the key", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 1 }),
    })

    await expect(deleteRedisKey("weekly-outfits:user-1:2026-06-07")).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/del/weekly-outfits%3Auser-1%3A2026-06-07",
      {
        method: "POST",
        headers: { Authorization: "Bearer rest-token" },
      },
    )
  })

  it("returns false when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.REDIS_URL

    await expect(deleteRedisKey("some-key")).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws when the REST API returns an error status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })

    await expect(deleteRedisKey("some-key")).rejects.toThrow("Redis DEL failed (503)")
  })
})

describe("deleteCachedWeeklyOutfits", () => {
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

  it("deletes the same cache key used by the skydiiv web app", async () => {
    await deleteCachedWeeklyOutfits("user-123", "2026-06-07")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/del/weekly-outfits%3Auser-123%3A2026-06-07",
      expect.any(Object),
    )
  })
})
