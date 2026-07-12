import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  parseUpstashRestFromRedisUrl,
  getUpstashRestCredentials,
  existsRedisKey,
  setRedisKey,
  setRedisKeyNx,
  deleteRedisKey,
} from "../../src/lib/cache/redis"

/**
 * Unit tests for the Redis REST client primitives.
 * Mocks the global `fetch` to verify correct URL construction, authorization
 * headers, and error propagation for each operation.
 */

describe("parseUpstashRestFromRedisUrl", () => {
  it("extracts url and token from a valid Upstash Redis URL", () => {
    const result = parseUpstashRestFromRedisUrl(
      "rediss://default:my-token@my-db.upstash.io:6379",
    )
    expect(result).toEqual({
      url: "https://my-db.upstash.io",
      token: "my-token",
    })
  })

  it("returns null for a non-Upstash Redis URL", () => {
    const result = parseUpstashRestFromRedisUrl("redis://localhost:6379")
    expect(result).toBeNull()
  })

  it("returns null for a malformed URL", () => {
    const result = parseUpstashRestFromRedisUrl("not-a-url")
    expect(result).toBeNull()
  })

  it("returns null when password is empty", () => {
    const result = parseUpstashRestFromRedisUrl("rediss://default:@my-db.upstash.io:6379")
    expect(result).toBeNull()
  })
})

describe("getUpstashRestCredentials", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.REDIS_URL
  })

  it("returns credentials from REST env vars when both are set", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://my-db.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "rest-token"

    const result = getUpstashRestCredentials()

    expect(result).toEqual({ url: "https://my-db.upstash.io", token: "rest-token" })
  })

  it("strips trailing slash from REST URL", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://my-db.upstash.io/"
    process.env.UPSTASH_REDIS_REST_TOKEN = "rest-token"

    const result = getUpstashRestCredentials()

    expect(result.url).toBe("https://my-db.upstash.io")
  })

  it("falls back to REDIS_URL when REST vars are not set", () => {
    process.env.REDIS_URL = "rediss://default:fallback-token@my-db.upstash.io:6379"

    const result = getUpstashRestCredentials()

    expect(result).toEqual({ url: "https://my-db.upstash.io", token: "fallback-token" })
  })

  it("throws when no Redis env vars are configured", () => {
    expect(() => getUpstashRestCredentials()).toThrow(
      "Redis credentials are not set",
    )
  })
})

describe("existsRedisKey", () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    process.env.UPSTASH_REDIS_REST_URL = "https://my-db.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it("returns true when the key exists (result: 1)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: 1 }),
    })

    const result = await existsRedisKey("my-key")

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-db.upstash.io/exists/my-key",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    )
  })

  it("returns false when the key does not exist (result: 0)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: 0 }),
    })

    const result = await existsRedisKey("missing-key")

    expect(result).toBe(false)
  })

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })

    await expect(existsRedisKey("my-key")).rejects.toThrow('Redis EXISTS failed for key "my-key" (401)')
  })

  it("URL-encodes the key", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 0 }) })

    await existsRedisKey("outbox-processing:evt uuid 1")

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("outbox-processing%3Aevt%20uuid%201"),
      expect.anything(),
    )
  })
})

describe("setRedisKey", () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    process.env.UPSTASH_REDIS_REST_URL = "https://my-db.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it("sets the key with a TTL when ttlSeconds is provided", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: "OK" }) })

    await setRedisKey("my-key", 300)

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-db.upstash.io/set/my-key/1/EX/300",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    )
  })

  it("sets the key without TTL when ttlSeconds is omitted", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: "OK" }) })

    await setRedisKey("my-key")

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-db.upstash.io/set/my-key/1",
      expect.anything(),
    )
  })

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(setRedisKey("my-key", 60)).rejects.toThrow('Redis SET failed for key "my-key" (500)')
  })
})

describe("setRedisKeyNx", () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    process.env.UPSTASH_REDIS_REST_URL = "https://my-db.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it("returns true when the key was set (result: OK)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: "OK" }),
    })

    const result = await setRedisKeyNx("my-key", 300)

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-db.upstash.io/set/my-key/1/EX/300/NX",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    )
  })

  it("returns false when the key already exists (result: null)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: null }),
    })

    const result = await setRedisKeyNx("my-key", 300)

    expect(result).toBe(false)
  })

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(setRedisKeyNx("my-key", 300)).rejects.toThrow(
      'Redis SET NX failed for key "my-key" (500)',
    )
  })

  it("URL-encodes the key", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: "OK" }) })

    await setRedisKeyNx("outbox-processing:evt uuid 1", 60)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("outbox-processing%3Aevt%20uuid%201"),
      expect.anything(),
    )
  })
})

describe("deleteRedisKey", () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch)
    process.env.UPSTASH_REDIS_REST_URL = "https://my-db.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it("sends a request to the /del/{key} endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 1 }) })

    await deleteRedisKey("my-key")

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-db.upstash.io/del/my-key",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    )
  })

  it("throws when the HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    await expect(deleteRedisKey("my-key")).rejects.toThrow('Redis DEL failed for key "my-key" (404)')
  })
})
