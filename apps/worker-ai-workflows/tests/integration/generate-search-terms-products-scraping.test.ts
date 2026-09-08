import { describe, it, expect, vi, beforeEach } from "vitest"
import { parseWardrobePanoramaIdPayload } from "../../src/lib/automatic-thrifting/payload"
import { insertSearchTermsStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/insert-search-terms"
import { loadGenerateSearchTermsContextStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/load-context"
import { skipIfUnprocessedSearchTermsStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/skip-if-unprocessed"
import { executeGenerateSearchTermsPromptStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/execute-prompt"
import { planFeedbackSummaryStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/plan-feedback-summary"
import { persistFeedbackSummaryStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/persist-feedback-summary"
import { summarizeFeedbackChunkStep } from "../../src/workflows/generate-search-terms-products-scraping/steps/summarize-feedback-chunk"

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

function writeSql(): string {
  return mocks.writeDb.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
      return []
    })
    .join(" ")
}

describe("generate-search-terms feedback summary steps", () => {
  beforeEach(() => {
    mocks.readDb.mockReset()
    mocks.writeDb.mockReset()
    mocks.llmGenerate.mockReset()
    Object.assign(mocks.writeDb, { json: (value: unknown) => value })
    delete process.env.FEEDBACK_SUMMARY_CHUNK_SIZE
    delete process.env.FEEDBACK_SUMMARY_MAX_ENTRIES
  })

  it("skips summarizer when the owner has no feedbacks", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("COUNT(*)")) return Promise.resolve([{ count: 0 }])
      if (query.includes("summaries_feedbacks_automatic_thrifting")) return Promise.resolve([])
      return Promise.resolve([])
    })

    const plan = await planFeedbackSummaryStep(mocks.userId)
    expect(plan.action).toBe("skip")
    expect(mocks.writeDb).not.toHaveBeenCalled()
  })

  it("plans clear-stale-empty when there are no feedbacks and the summary is outdated", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("COUNT(*)")) return Promise.resolve([{ count: 0 }])
      if (query.includes("summaries_feedbacks_automatic_thrifting")) {
        return Promise.resolve([
          {
            id: "s1",
            user_id: mocks.userId,
            summary: "old",
            outdated: true,
            updated_at: new Date("2026-09-01T00:00:00.000Z"),
          },
        ])
      }
      return Promise.resolve([])
    })
    mocks.writeDb.mockResolvedValue([])

    const plan = await planFeedbackSummaryStep(mocks.userId)
    expect(plan.action).toBe("clear-stale-empty")
    await persistFeedbackSummaryStep({
      userId: mocks.userId,
      summary: "",
      readAtIso: plan.readAtIso,
      clearStaleEmpty: true,
    })
    expect(writeSql()).toMatch(/UPDATE summaries_feedbacks_automatic_thrifting/)
    expect(writeSql()).not.toMatch(/INSERT INTO search_terms_scraped_products/)
  })

  it("plans refresh when the existing summary is outdated", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("COUNT(*)")) return Promise.resolve([{ count: 1 }])
      if (query.includes("summaries_feedbacks_automatic_thrifting")) {
        return Promise.resolve([
          {
            id: "s1",
            user_id: mocks.userId,
            summary: "old",
            outdated: true,
            updated_at: new Date("2026-09-01T00:00:00.000Z"),
          },
        ])
      }
      if (query.includes("feedbacks_automatic_thrifting")) {
        return Promise.resolve([
          {
            id: "f1",
            user_id: mocks.userId,
            scraped_product_id: "sp1",
            liked: true,
            reason: null,
            json_search: { term: "jaqueta" },
            json_result: { marketplace: "enjoei", metadata: { size: "M" } },
            json_listed_product: { marketplace: "enjoei", title: "jaqueta" },
            created_at: new Date("2026-09-01T00:00:00.000Z"),
          },
        ])
      }
      return Promise.resolve([])
    })
    expect(await planFeedbackSummaryStep(mocks.userId)).toMatchObject({ action: "refresh" })
  })

  it("reuses a current summary without calling the summarizer LLM", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("COUNT(*)")) return Promise.resolve([{ count: 2 }])
      if (query.includes("summaries_feedbacks_automatic_thrifting")) {
        return Promise.resolve([
          {
            id: "s1",
            user_id: mocks.userId,
            summary: "kept",
            outdated: false,
            updated_at: new Date("2026-09-01T00:00:00.000Z"),
          },
        ])
      }
      return Promise.resolve([])
    })

    const plan = await planFeedbackSummaryStep(mocks.userId)
    expect(plan).toMatchObject({ action: "reuse", reusedSummary: "kept" })
    expect(mocks.llmGenerate).not.toHaveBeenCalled()
  })

  it("refreshes a missing summary from Enjoei factory records, not raw JSON", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("COUNT(*)")) return Promise.resolve([{ count: 1 }])
      if (query.includes("summaries_feedbacks_automatic_thrifting")) return Promise.resolve([])
      if (query.includes("feedbacks_automatic_thrifting")) {
        return Promise.resolve([
          {
            id: "f1",
            user_id: mocks.userId,
            scraped_product_id: "sp1",
            liked: true,
            reason: "legal",
            json_search: { term: "blazer bege", gender: "Female", topSize: "M" },
            json_result: {
              marketplace: "enjoei",
              title: "blazer",
              url: "https://www.enjoei.com.br/p/1",
              image_url: "https://photos.enjoei.com.br/1.png",
              metadata: { size: "M" },
            },
            json_listed_product: { marketplace: "enjoei", title: "blazer listed" },
            created_at: new Date("2026-09-01T00:00:00.000Z"),
          },
        ])
      }
      return Promise.resolve([])
    })
    mocks.llmGenerate.mockResolvedValue("costuma gostar de blazer")
    mocks.writeDb.mockResolvedValue([])

    const plan = await planFeedbackSummaryStep(mocks.userId)
    expect(plan.action).toBe("refresh")
    if (plan.action !== "refresh") throw new Error("expected refresh")

    const summary = await summarizeFeedbackChunkStep({
      userId: mocks.userId,
      locale: "pt-BR",
      chunkIndex: 0,
      chunkSize: plan.chunkSize,
      maxEntries: plan.maxEntries,
      priorSummary: "",
    })
    expect(summary).toBe("costuma gostar de blazer")
    const llmPrompt = mocks.llmGenerate.mock.calls[0]?.[0] as string
    expect(llmPrompt).toContain("blazer listed")
    expect(llmPrompt).toContain('"liked":true')
    expect(llmPrompt).not.toMatch(/json_search|json_listed_product|image_url/)
    expect(llmPrompt).not.toContain("https://www.enjoei.com.br")

    await persistFeedbackSummaryStep({
      userId: mocks.userId,
      summary,
      readAtIso: plan.readAtIso,
    })
    expect(writeSql()).toMatch(/INSERT INTO summaries_feedbacks_automatic_thrifting/)
    expect(writeSql()).toMatch(/llm_interactions/)
    expect(writeSql()).not.toMatch(/INSERT INTO search_terms_scraped_products/)
  })

  it("does not insert search terms when the summarizer LLM fails", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      const query = Array.isArray(strings) ? strings.join("") : String(strings)
      if (query.includes("feedbacks_automatic_thrifting")) {
        return Promise.resolve([
          {
            id: "f1",
            user_id: mocks.userId,
            scraped_product_id: "sp1",
            liked: false,
            reason: null,
            json_search: { term: "x" },
            json_result: { marketplace: "enjoei", metadata: { size: "M" } },
            json_listed_product: { marketplace: "enjoei", title: "x" },
            created_at: new Date("2026-09-01T00:00:00.000Z"),
          },
        ])
      }
      return Promise.resolve([])
    })
    mocks.llmGenerate.mockRejectedValue(new Error("gemini down"))
    mocks.writeDb.mockResolvedValue([])

    await expect(
      summarizeFeedbackChunkStep({
        userId: mocks.userId,
        locale: "pt-BR",
        chunkIndex: 0,
        chunkSize: 50,
        maxEntries: 250,
        priorSummary: "",
      }),
    ).rejects.toThrow("gemini down")

    expect(writeSql()).toMatch(/llm_interactions/)
    expect(writeSql()).not.toMatch(/INSERT INTO search_terms_scraped_products/)
  })

  it("skip-if-unprocessed does not write summaries", async () => {
    mocks.readDb.mockImplementation((strings: TemplateStringsArray) => {
      if (sqlIncludes(strings, "is_processed")) return Promise.resolve([{ has_unprocessed: true }])
      return Promise.resolve([])
    })
    await expect(skipIfUnprocessedSearchTermsStep(mocks.panoramaId)).resolves.toBe(true)
    expect(mocks.writeDb).not.toHaveBeenCalled()
    expect(writeSql()).not.toMatch(/summaries_feedbacks_automatic_thrifting/)
  })
})
