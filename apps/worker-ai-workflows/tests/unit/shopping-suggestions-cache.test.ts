import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  buildNewShoppingSuggestionsNotificationKey,
  buildShoppingSuggestionsKey,
  notifyShoppingSuggestionsReady,
} from "../../src/lib/cache/shopping-suggestions-cache"

describe("shopping-suggestions Redis keys", () => {
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

  it("uses the exact web list and notification keys", () => {
    expect(buildShoppingSuggestionsKey("u1")).toBe("shopping-suggestions:u1")
    expect(buildNewShoppingSuggestionsNotificationKey("u1")).toBe(
      "notification:new-shopping-suggestions:u1",
    )
  })

  it("DELs the list cache and SETs the notification payload", async () => {
    await notifyShoppingSuggestionsReady("u1")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/del/shopping-suggestions%3Au1",
      expect.objectContaining({ method: "POST" }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "https://us1-example.upstash.io/set/notification%3Anew-shopping-suggestions%3Au1",
      expect.objectContaining({ method: "POST" }),
    )

    const setCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("notification"),
    )
    const init = setCall?.[1] as RequestInit
    if (typeof init.body !== "string") {
      throw new Error("Expected fetch body to be a string")
    }
    expect(JSON.parse(init.body)).toEqual(
      expect.objectContaining({
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    )
  })

  it("logs and does not throw when Redis fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    await expect(notifyShoppingSuggestionsReady("u1")).resolves.toBeUndefined()
  })
})
