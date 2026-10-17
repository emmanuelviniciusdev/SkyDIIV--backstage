import { describe, it, expect } from "vitest"
import {
  buildAnalyzeScrapedResultsPrompt,
  toAnalyzePromptListing,
} from "../../../src/lib/i18n/prompts/analyze-scraped-results"
import type { UnprocessedScrapeResult } from "../../../src/lib/db/scraped-products-swap.repository"

const RESULT: UnprocessedScrapeResult = {
  resultId: "r1",
  searchTermId: "s1",
  marketplace: "enjoei",
  jsonSearch: {
    term: "casual blazer",
    gender: "Female",
    topSize: "M",
    footSize: null,
    bottomSize: null,
  },
  jsonResult: {
    marketplace: "enjoei",
    title: "beige blazer",
    price: 80,
    currency: "BRL",
    url: "https://marketplace.example/p/1",
    image_url: "https://img.example/1.jpg",
    metadata: {
      size: "M",
      searchParams: {
        brand: null,
        gender: "Female",
        searchTerm: "casual blazer",
      },
    },
  },
}

describe("toAnalyzePromptListing()", () => {
  it("keeps identifiers and listing fields used to judge ads", () => {
    expect(toAnalyzePromptListing(RESULT)).toEqual({
      searchTermScrapedProductId: "s1",
      resultId: "r1",
      title: "beige blazer",
      price: 80,
      currency: "BRL",
      size: "M",
    })
  })
})

describe("buildAnalyzeScrapedResultsPrompt()", () => {
  it("embeds slim listing objects without scrape snapshots or URLs", () => {
    const prompt = buildAnalyzeScrapedResultsPrompt({
      locale: "pt-BR",
      panoramaContent: "## o que vale buscar\nblazer",
      routineDescription: "escritório",
      results: [RESULT],
    })

    expect(prompt).toContain("## o que vale buscar")
    expect(prompt).toContain("escritório")
    expect(prompt).toContain('"searchTermScrapedProductId":"s1"')
    expect(prompt).toContain('"resultId":"r1"')
    expect(prompt).toContain('"title":"beige blazer"')
    expect(prompt).not.toMatch(/jsonSearch|jsonResult|json_search|json_result/)
    expect(prompt).not.toMatch(/image_url|imageUrl/)
    expect(prompt).not.toMatch(/https:\/\//)
    expect(prompt).not.toContain("searchParams")
    expect(prompt).not.toContain("marketplace")
    expect(prompt).not.toContain('"searchTerm"')
  })
})
