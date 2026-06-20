import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  setNotification,
  setNewWeeklyOutfitsNotification,
  setNewWardrobePanoramaNotification,
  NOTIFICATION_TYPES,
} from "../../src/lib/cache/notification-cache"

describe("setNotification", () => {
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
      json: () => Promise.resolve({ result: "OK" }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
    fetchMock.mockReset()
  })

  it("stores the weekly outfits notification under the same key used by the skydiiv web app", async () => {
    await setNewWeeklyOutfitsNotification("user-123")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/set/notification--new-weekly-outfits--user-123",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer rest-token" },
      }),
    )

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    if (typeof init.body !== "string") {
      throw new Error("Expected fetch body to be a string")
    }
    expect(JSON.parse(init.body)).toEqual(
      expect.objectContaining({
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    )
  })

  it("stores the wardrobe panorama notification under the same key used by the skydiiv web app", async () => {
    await setNewWardrobePanoramaNotification("user-123")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/set/notification--new-wardrobe-panorama--user-123",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("returns false when Redis is not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.REDIS_URL

    await expect(
      setNotification("user-123", NOTIFICATION_TYPES.NEW_WEEKLY_OUTFITS),
    ).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws when the REST API returns an error status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })

    await expect(setNewWeeklyOutfitsNotification("user-123")).rejects.toThrow(
      "Redis SET failed (503)",
    )
  })
})
