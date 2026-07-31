import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createWebAppRedisClient,
  isPlainRedisUrl,
  parseRedisRestFromUrl,
  resolveWebAppRedisRestCredentials,
  WebAppNativeRedisClient,
  WebAppRedisRestClient,
} from "../../src/infrastructure/cache/redis.js"
import { WebAppCacheAdapter } from "../../src/infrastructure/cache/web-app-cache.adapter.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("parseRedisRestFromUrl", () => {
  it("parses TLS Redis URLs into REST credentials", () => {
    expect(
      parseRedisRestFromUrl(
        "rediss://default:rest-token@redis.example.com:6379",
      ),
    ).toEqual({
      url: "https://redis.example.com",
      token: "rest-token",
    })
  })

  it("returns null for non-TLS Redis URLs", () => {
    expect(parseRedisRestFromUrl("redis://127.0.0.1:6379")).toBeNull()
  })
})

describe("resolveWebAppRedisRestCredentials", () => {
  it("prefers REST URL/token for the web-app Redis", () => {
    expect(
      resolveWebAppRedisRestCredentials({
        webAppRedisRestUrl: "https://redis.example.com/",
        webAppRedisRestToken: "rest-token",
        webAppRedisUrl: "rediss://default:ignored@other.example.com:6379",
      }),
    ).toEqual({
      url: "https://redis.example.com",
      token: "rest-token",
    })
  })

  it("falls back to WEB_APP_REDIS_URL (Upstash rediss://)", () => {
    expect(
      resolveWebAppRedisRestCredentials({
        webAppRedisUrl: "rediss://default:from-web@redis.example.com:6379",
      }),
    ).toEqual({
      url: "https://redis.example.com",
      token: "from-web",
    })
  })
})

describe("createWebAppRedisClient", () => {
  it("uses native Redis for plain redis:// URLs (local dev)", () => {
    const client = createWebAppRedisClient({
      webAppRedisUrl: "redis://host.docker.internal:6379",
    })
    expect(client).toBeInstanceOf(WebAppNativeRedisClient)
    expect(client.isConfigured).toBe(true)
  })

  it("prefers REST credentials over WEB_APP_REDIS_URL", () => {
    const client = createWebAppRedisClient({
      webAppRedisRestUrl: "https://redis.example.com",
      webAppRedisRestToken: "rest-token",
      webAppRedisUrl: "redis://host.docker.internal:6379",
    })
    expect(client).toBeInstanceOf(WebAppRedisRestClient)
    expect(client.isConfigured).toBe(true)
  })

  it("returns unconfigured client when Redis env is missing", () => {
    const client = createWebAppRedisClient({})
    expect(client.isConfigured).toBe(false)
  })
})

describe("isPlainRedisUrl", () => {
  it("detects redis:// URLs", () => {
    expect(isPlainRedisUrl("redis://127.0.0.1:6379")).toBe(true)
    expect(isPlainRedisUrl("rediss://default:token@host:6379")).toBe(false)
  })
})

describe("WebAppCacheAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("deletes shopping-suggestions:{userId} and sets shopping-suggestions notification", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "OK" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const redis = new WebAppRedisRestClient({
      url: "https://redis.example.com",
      token: "rest-token",
    })
    const cache = new WebAppCacheAdapter(redis, silentLogger())

    await cache.invalidateShoppingSuggestions("user-42")
    await cache.setNewShoppingSuggestionsNotification("user-42")

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://redis.example.com/del/shopping-suggestions%3Auser-42",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://redis.example.com/set/notification%3Anew-shopping-suggestions%3Auser-42",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("updatedAt"),
      }),
    )
  })

  it("skips when web-app Redis is not configured", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const cache = new WebAppCacheAdapter(new WebAppRedisRestClient(null), silentLogger())
    await cache.invalidateShoppingSuggestions("user-42")
    await cache.setNewShoppingSuggestionsNotification("user-42")

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
