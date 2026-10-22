import { afterEach, describe, expect, it, vi } from "vitest"
import { FieldEncryptionError } from "../../src/lib/field-encryption/field-encryption"
import {
  createKekStore,
  ENCRYPTION_KEY_CACHE_REDIS_KEY,
  ENCRYPTION_KEY_CACHE_TTL_SECONDS,
} from "../../src/lib/field-encryption/kek-store"
import {
  LOCAL_ENCRYPTION_KEY_VERSION,
  LOCAL_KEK,
  LOCAL_LOOKUP_KEY,
} from "../../src/lib/field-encryption/local-encryption-keys"
import { openListedRow } from "../../src/lib/field-encryption/open-seal"
import { sealModelValues } from "../../src/lib/field-encryption/field-encryption"

const kek = Buffer.alloc(32, 4).toString("base64")
const lookupKey = Buffer.alloc(32, 5).toString("base64")

const productionEnv = {
  DEPLOYMENT_ENVIRONMENT: "production",
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID: "database",
  CLOUDFLARE_D1_API_TOKEN: "token",
} as NodeJS.ProcessEnv

function d1Response(rows: unknown) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      result: [{ results: rows }],
    }),
  } as Response
}

const d1Rows = [
  {
    kek,
    kek_version: 2,
    lookup_key: lookupKey,
    lookup_key_version: 4,
  },
]

describe("kek store", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.REDIS_URL
  })

  it("loads local test vectors when DEPLOYMENT_ENVIRONMENT is local or unset", async () => {
    for (const env of [
      { DEPLOYMENT_ENVIRONMENT: "local" } as NodeJS.ProcessEnv,
      {} as NodeJS.ProcessEnv,
    ]) {
      const fetchImpl = vi.fn()
      const readCache = vi.fn()
      const writeCache = vi.fn()
      const store = createKekStore({ env, fetchImpl, readCache, writeCache })
      const keys = await store.loadEncryptionKeys()

      expect(fetchImpl).not.toHaveBeenCalled()
      expect(readCache).not.toHaveBeenCalled()
      expect(writeCache).not.toHaveBeenCalled()
      expect(keys.kek.equals(LOCAL_KEK)).toBe(true)
      expect(keys.lookupKey.equals(LOCAL_LOOKUP_KEY)).toBe(true)
      expect(keys.kekVersion).toBe(LOCAL_ENCRYPTION_KEY_VERSION)
      expect(keys.lookupKeyVersion).toBe(LOCAL_ENCRYPTION_KEY_VERSION)
      expect(keys.kekByVersion.get(1)?.equals(LOCAL_KEK)).toBe(true)
    }
  })

  it("loads keys from D1 on a Redis miss and serves the next call from the cache", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(d1Response(d1Rows))
    let cached: unknown = null
    let cacheKey = ""
    const store = createKekStore({
      env: productionEnv,
      fetchImpl,
      readCache: async (key) => {
        cacheKey = key
        return cached
      },
      writeCache: async (key, value, ttlSeconds) => {
        expect(key).toBe("encryption:database-keys")
        expect(key).toBe(ENCRYPTION_KEY_CACHE_REDIS_KEY)
        expect(ttlSeconds).toBe(3600)
        expect(ttlSeconds).toBe(ENCRYPTION_KEY_CACHE_TTL_SECONDS)
        cached = value
      },
    })

    const first = await store.loadEncryptionKeys()
    const second = await store.loadEncryptionKeys()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(cacheKey).toBe("encryption:database-keys")
    expect(first.kekVersion).toBe(2)
    expect(first.lookupKeyVersion).toBe(4)
    expect(first.kek.equals(Buffer.alloc(32, 4))).toBe(true)
    expect(second.lookupKey.equals(Buffer.alloc(32, 5))).toBe(true)
    expect(second.kekByVersion.get(2)?.equals(first.kek)).toBe(true)
    const request = fetchImpl.mock.calls[0]?.[1] as RequestInit
    const requestBody = request.body
    expect(typeof requestBody === "string" ? requestBody : "").toContain("encryption_keys")
    const requestUrl = fetchImpl.mock.calls[0]?.[0]
    expect(typeof requestUrl === "string" ? requestUrl : "").toContain(
      "/accounts/account/d1/database/database/query",
    )
  })

  it("uses D1 for staging the same way as production", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(d1Response(d1Rows))
    const store = createKekStore({
      env: { ...productionEnv, DEPLOYMENT_ENVIRONMENT: "staging" },
      fetchImpl,
      readCache: async () => null,
      writeCache: async () => undefined,
    })
    const keys = await store.loadEncryptionKeys()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(keys.kekVersion).toBe(2)
  })

  it("reads a Redis hit through the Redis helper and does not call D1", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "token"
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url)
      const command = typeof init?.body === "string" ? JSON.parse(init.body) as unknown[] : []
      if (href.includes("upstash.io") && command[0] === "GET") {
        expect(command[1]).toBe("encryption:database-keys")
        return {
          ok: true,
          json: async () => ({ result: JSON.stringify(d1Rows) }),
        } as Response
      }
      if (href.includes("api.cloudflare.com")) {
        throw new Error("D1 should not be called on a cache hit")
      }
      throw new Error(`unexpected fetch ${href}`)
    })
    vi.stubGlobal("fetch", fetchImpl)

    const store = createKekStore({ env: productionEnv })
    const keys = await store.loadEncryptionKeys()

    expect(keys.kekVersion).toBe(2)
    expect(keys.kek.equals(Buffer.alloc(32, 4))).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("writes encryption:database-keys for 3600 seconds through the Redis helper on a miss", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "token"
    const bodies: unknown[][] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("api.cloudflare.com")) return d1Response(d1Rows)
      const rawBody = init?.body
      const command = JSON.parse(typeof rawBody === "string" ? rawBody : "[]") as unknown[]
      bodies.push(command)
      if (command[0] === "GET") return { ok: true, json: async () => ({ result: null }) } as Response
      if (command[0] === "SET") return { ok: true, json: async () => ({ result: "OK" }) } as Response
      throw new Error(`unexpected ${href}`)
    })
    vi.stubGlobal("fetch", fetchImpl)

    const store = createKekStore({ env: productionEnv })
    await store.loadEncryptionKeys()

    const set = bodies.find((command) => command[0] === "SET")
    expect(set?.[1]).toBe("encryption:database-keys")
    expect(set?.[3]).toBe("EX")
    expect(set?.[4]).toBe(3600)
    const cachedPayload = set?.[2]
    const cached = JSON.parse(typeof cachedPayload === "string" ? cachedPayload : "[]") as Array<{
      kekVersion?: number
    }>
    expect(cached[0]?.kekVersion).toBe(2)
  })

  it("fails closed when D1 env is missing in production and does not call D1", async () => {
    const fetchImpl = vi.fn()
    const writeCache = vi.fn()
    const store = createKekStore({
      env: { DEPLOYMENT_ENVIRONMENT: "production" },
      fetchImpl,
      readCache: async () => null,
      writeCache,
    })

    await expect(store.loadEncryptionKeys()).rejects.toThrow(/unavailable/i)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(writeCache).not.toHaveBeenCalled()
  })

  it("fails closed when the provider request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    const writeCache = vi.fn()
    const store = createKekStore({
      env: productionEnv,
      fetchImpl,
      readCache: async () => null,
      writeCache,
    })

    await expect(store.loadEncryptionKeys()).rejects.toThrow(/unavailable/i)
    expect(writeCache).not.toHaveBeenCalled()
  })

  it("fails closed when a key is not 32-byte base64", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      d1Response([
        {
          kek: Buffer.alloc(16, 1).toString("base64"),
          kek_version: 1,
          lookup_key: lookupKey,
          lookup_key_version: 1,
        },
      ]),
    )
    const store = createKekStore({
      env: productionEnv,
      fetchImpl,
      readCache: async () => null,
      writeCache: async () => undefined,
    })

    await expect(store.loadEncryptionKeys()).rejects.toThrow(/unavailable/i)
  })

  it("fails closed when a row kek_version is not in the loaded set", async () => {
    const previous = process.env.DEPLOYMENT_ENVIRONMENT
    delete process.env.DEPLOYMENT_ENVIRONMENT
    const sealed = sealModelValues({
      model: "WardrobePanorama",
      rowId: "panorama-1",
      values: { content: "# Wardrobe" },
      kek: LOCAL_KEK,
      kekVersion: LOCAL_ENCRYPTION_KEY_VERSION,
      lookupKey: LOCAL_LOOKUP_KEY,
    })
    const ciphertext = sealed.values.content
    if (!ciphertext) throw new Error("expected ciphertext")

    await expect(
      openListedRow({
        model: "WardrobePanorama",
        rowId: "panorama-1",
        values: { content: ciphertext },
        dek: sealed.dek,
        kekVersion: 99,
        encryptedColumns: ["content"],
      }),
    ).rejects.toBeInstanceOf(FieldEncryptionError)
    if (previous === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT
    else process.env.DEPLOYMENT_ENVIRONMENT = previous
  })
})
