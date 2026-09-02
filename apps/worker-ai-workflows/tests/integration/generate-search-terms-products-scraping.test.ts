import { describe, it, expect, vi } from "vitest"
import { parseWardrobePanoramaIdPayload } from "../../src/lib/automatic-thrifting/payload"
import { insertSearchTermsStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/insert-search-terms"
import { loadGenerateSearchTermsContextStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/load-context"
import { skipIfUnprocessedSearchTermsStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/skip-if-unprocessed"
import { executeGenerateSearchTermsPromptStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/execute-prompt"

const mocks = vi.hoisted(() => {
  const panoramaId = "p1"
  const userId = "user-1"
  const readDb = vi.fn()
  const writeDb = vi.fn()
  Object.assign(writeDb, { json: (value: unknown) => value })
  const llmGenerate = vi.fn()

  return { panoramaId, userId, readDb, writeDb, llmGenerate }
})

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.readDb,
  getWriteDb: () => mocks.writeDb,
  resetDbClients: vi.fn(),
}))

vi.mock("../../src/lib/llm/index", () => ({
  getLlmProvider: () => ({ name: "mock-llm", generate: mocks.llmGenerate }),
  registerLlmProvider: vi.fn(),
}))

function sqlIncludes(query: unknown, fragment: string): boolean {
  const text = Array.isArray(query) ? query.join("") : String(query)
  return text.includes(fragment)
}

describe("generate-search-terms-products-scraping", () => {
  it("fails a missing panorama id without writing search terms", () => {
    expect(() => parseWardrobePanoramaIdPayload({})).toThrow(/wardrobePanoramaId/)
    expect(mocks.writeDb).not.toHaveBeenCalled()
  })

  it("skips insert when unprocessed search terms already exist", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      if (sqlIncludes(strings, "is_processed")) return Promise.resolve([{ has_unprocessed: true }])
      return Promise.resolve([])
    })

    await expect(skipIfUnprocessedSearchTermsStep(mocks.panoramaId)).resolves.toBe(true)
    expect(mocks.writeDb).not.toHaveBeenCalled()
  })

  it("inserts at most 10 unprocessed rows without deleting scraped_products", async () => {
    mocks.writeDb.mockResolvedValue([])

    const count = await insertSearchTermsStep({
      wardrobePanoramaId: mocks.panoramaId,
      llmInteractionId: "llm-1",
      suggestions: Array.from({ length: 8 }, (_, i) => ({
        term: `blazer ${i}`,
        sizeCategory: "top" as const,
      })),
      shoppingPreferences: {
        gender: "Female",
        topSize: "M",
        bottomSize: "40",
        footSize: "38",
      },
      eligibleMarketplaces: [{ id: "m1", name: "enjoei", supportedLanguages: ["pt-BR"] }],
    })

    expect(count).toBe(8)
    const sql = mocks.writeDb.mock.calls
      .flatMap((call) => {
        const first = call[0]
        if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
        return []
      })
      .join(" ")
    expect(sql).toMatch(/INSERT INTO search_terms_scraped_products/)
    expect(sql).not.toMatch(/DELETE/)
    expect(sql).not.toMatch(/FROM scraped_products/)
  })

  it("loads pt-BR/enjoei context and leaves scraped_products unread", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("wardrobe_panorama")) {
        return Promise.resolve([{ id: mocks.panoramaId, user_id: mocks.userId, content: "## o que vale buscar" }])
      }
      if (query.includes("app_preferences")) return Promise.resolve([{ name: "Português (BR)" }])
      if (query.includes("weekly_outfit_preferences")) {
        return Promise.resolve([
          {
            id: "prefs-1",
            user_id: mocks.userId,
            location: "São Paulo",
            routine_description: "escritório",
          },
        ])
      }
      if (query.includes("shopping_suggestions_preferences")) {
        return Promise.resolve([
          { gender: "Female", top_size: "M", bottom_size: "40", foot_size: "38" },
        ])
      }
      if (query.includes("marketplaces_catalog_scraped_products")) {
        return Promise.resolve([{ id: "m1", name: "enjoei", supported_languages: ["pt-BR"] }])
      }
      return Promise.resolve([])
    })

    const ctx = await loadGenerateSearchTermsContextStep(mocks.panoramaId)
    expect(ctx.locale).toBe("pt-BR")
    expect(ctx.eligibleMarketplaces).toEqual([
      { id: "m1", name: "enjoei", supportedLanguages: ["pt-BR"] },
    ])
    const readSql = mocks.readDb.mock.calls
      .flatMap((call) => {
        const first = call[0]
        if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
        return []
      })
      .join(" ")
    expect(readSql).not.toMatch(/DELETE/)
    expect(readSql).not.toMatch(/FROM scraped_products/)
  })

  it("uses the user locale when the marketplace supports it", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("wardrobe_panorama")) {
        return Promise.resolve([{ id: mocks.panoramaId, user_id: mocks.userId, content: "md" }])
      }
      if (query.includes("app_preferences")) return Promise.resolve([{ name: "Español (PE)" }])
      if (query.includes("weekly_outfit_preferences")) return Promise.resolve([])
      if (query.includes("shopping_suggestions_preferences")) return Promise.resolve([])
      if (query.includes("marketplaces_catalog_scraped_products")) {
        return Promise.resolve([
          { id: "m1", name: "enjoei", supported_languages: ["pt-BR", "es-PE"] },
        ])
      }
      return Promise.resolve([])
    })

    const ctx = await loadGenerateSearchTermsContextStep(mocks.panoramaId)
    expect(ctx.locale).toBe("es-PE")
    expect(ctx.eligibleMarketplaces).toEqual([
      { id: "m1", name: "enjoei", supportedLanguages: ["pt-BR", "es-PE"] },
    ])
  })

  it("uses a marketplace language when the user locale is not supported", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("wardrobe_panorama")) {
        return Promise.resolve([{ id: mocks.panoramaId, user_id: mocks.userId, content: "md" }])
      }
      if (query.includes("app_preferences")) return Promise.resolve([{ name: "Español (PE)" }])
      if (query.includes("weekly_outfit_preferences")) return Promise.resolve([])
      if (query.includes("shopping_suggestions_preferences")) return Promise.resolve([])
      if (query.includes("marketplaces_catalog_scraped_products")) {
        return Promise.resolve([{ id: "m1", name: "enjoei", supported_languages: ["pt-BR"] }])
      }
      return Promise.resolve([])
    })

    const ctx = await loadGenerateSearchTermsContextStep(mocks.panoramaId)
    expect(ctx.locale).toBe("pt-BR")
    expect(ctx.eligibleMarketplaces).toEqual([
      { id: "m1", name: "enjoei", supportedLanguages: ["pt-BR"] },
    ])
  })

  it("empty catalog yields zero eligible marketplaces", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("wardrobe_panorama")) {
        return Promise.resolve([{ id: mocks.panoramaId, user_id: mocks.userId, content: "md" }])
      }
      if (query.includes("app_preferences")) return Promise.resolve([{ name: "Español (PE)" }])
      if (query.includes("weekly_outfit_preferences")) return Promise.resolve([])
      if (query.includes("shopping_suggestions_preferences")) return Promise.resolve([])
      if (query.includes("marketplaces_catalog_scraped_products")) {
        return Promise.resolve([])
      }
      return Promise.resolve([])
    })

    const ctx = await loadGenerateSearchTermsContextStep(mocks.panoramaId)
    expect(ctx.locale).toBe("es-PE")
    expect(ctx.eligibleMarketplaces).toEqual([])
  })

  it("parses LLM terms for insert", async () => {
    mocks.llmGenerate.mockResolvedValueOnce(
      JSON.stringify([
        { term: "blazer casual bege", sizeCategory: "top" },
        { term: "tênis branco", sizeCategory: "foot" },
      ]),
    )
    mocks.writeDb.mockResolvedValue([])

    const result = await executeGenerateSearchTermsPromptStep({
      userId: mocks.userId,
      prompt: "prompt",
    })
    expect(result.suggestions).toHaveLength(2)
    expect(result.suggestions[0]?.term).toBe("blazer casual bege")
  })
})
