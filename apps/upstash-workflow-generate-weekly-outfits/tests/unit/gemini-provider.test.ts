import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { GeminiProvider } from "../../src/lib/llm/gemini.provider"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGeminiResponse(text: string) {
  return {
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
  }
}

const VALID_PROMPT = "Generate outfits for the week."

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-api-key"
})

afterEach(() => {
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_API_URL
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GeminiProvider", () => {
  it("sends POST to the Gemini API with the correct headers", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => makeGeminiResponse("[]"),
    } as Response)

    const provider = new GeminiProvider()
    await provider.generate(VALID_PROMPT)

    const call = vi.mocked(fetch).mock.calls[0]
    const [, options] = call as [string, RequestInit]
    expect((options.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-api-key")
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
    expect(options.method).toBe("POST")
  })

  it("uses the default model (gemini-2.5-flash) when GEMINI_MODEL is not set", async () => {
    let capturedUrl = ""
    vi.spyOn(global, "fetch").mockImplementationOnce(async (url) => {
      capturedUrl = String(url)
      return { ok: true, json: async () => makeGeminiResponse("[]") } as Response
    })

    const provider = new GeminiProvider()
    await provider.generate(VALID_PROMPT)

    expect(capturedUrl).toContain("gemini-2.5-flash")
  })

  it("uses the GEMINI_MODEL env override when set", async () => {
    process.env.GEMINI_MODEL = "gemini-2.5-pro"
    let capturedUrl = ""
    vi.spyOn(global, "fetch").mockImplementationOnce(async (url) => {
      capturedUrl = String(url)
      return { ok: true, json: async () => makeGeminiResponse("[]") } as Response
    })

    const provider = new GeminiProvider()
    await provider.generate(VALID_PROMPT)

    expect(capturedUrl).toContain("gemini-2.5-pro")
  })

  it("uses the GEMINI_API_URL override when set", async () => {
    process.env.GEMINI_API_URL = "https://proxy.example.com/llm"
    let capturedUrl = ""
    vi.spyOn(global, "fetch").mockImplementationOnce(async (url) => {
      capturedUrl = String(url)
      return { ok: true, json: async () => makeGeminiResponse("[]") } as Response
    })

    const provider = new GeminiProvider()
    await provider.generate(VALID_PROMPT)

    expect(capturedUrl).toBe("https://proxy.example.com/llm")
  })

  it("returns the text from the first candidate", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => makeGeminiResponse("Hello from Gemini"),
    } as Response)

    const provider = new GeminiProvider()
    const result = await provider.generate(VALID_PROMPT)

    expect(result).toBe("Hello from Gemini")
  })

  it("throws when the API returns a non-OK status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
    } as unknown as Response)

    const provider = new GeminiProvider()
    await expect(provider.generate(VALID_PROMPT)).rejects.toThrow("429")
  })

  it("throws when finishReason is MAX_TOKENS", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "truncated" }] }, finishReason: "MAX_TOKENS" }],
      }),
    } as Response)

    const provider = new GeminiProvider()
    await expect(provider.generate(VALID_PROMPT)).rejects.toThrow("MAX_TOKENS")
  })

  it("throws when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY
    const provider = new GeminiProvider()
    await expect(provider.generate(VALID_PROMPT)).rejects.toThrow("GEMINI_API_KEY")
  })

  it("concatenates multiple text parts from a single candidate", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: "Hello" }, { text: " World" }] },
            finishReason: "STOP",
          },
        ],
      }),
    } as Response)

    const provider = new GeminiProvider()
    const result = await provider.generate(VALID_PROMPT)
    expect(result).toBe("Hello World")
  })
})
