import { describe, it, expect } from "vitest"
import {
  ANALYZE_LEAST_BAD_SELECTION_INSTRUCTION,
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
    expect(prompt).toContain(ANALYZE_LEAST_BAD_SELECTION_INSTRUCTION)
    expect(prompt).toContain("Grupo s1 (termo: casual blazer):")
    expect(prompt).toContain("tipo de peça diferente é inconsistente")
    expect(prompt).toContain("Um array vazio só é válido quando não houver anúncio consistente")
    expect(prompt).not.toContain("omita esse termo")
  })

  it("keeps every search-term group together and still requires one pick", () => {
    const second = {
      ...RESULT,
      resultId: "r2",
      searchTermId: "s1",
      jsonResult: { ...RESULT.jsonResult, title: "navy blazer" },
    }
    const otherTerm = {
      ...RESULT,
      resultId: "r3",
      searchTermId: "s2",
      jsonSearch: { ...RESULT.jsonSearch, term: "calça reta" },
      jsonResult: { ...RESULT.jsonResult, title: "calça preta" },
    }

    const prompt = buildAnalyzeScrapedResultsPrompt({
      locale: "pt-BR",
      panoramaContent: "panorama",
      routineDescription: null,
      results: [RESULT, otherTerm, second],
    })

    const firstGroup = prompt.indexOf("Grupo s1 (termo: casual blazer):")
    const secondListing = prompt.indexOf('"resultId":"r2"')
    const otherGroup = prompt.indexOf("Grupo s2 (termo: calça reta):")
    expect(firstGroup).toBeGreaterThan(-1)
    expect(secondListing).toBeGreaterThan(firstGroup)
    expect(otherGroup).toBeGreaterThan(secondListing)
    expect(prompt).toContain("menos ruim")
    expect(prompt).toContain("Nunca devolva um array vazio quando houver anúncio consistente")
    expect(prompt).toContain("Nunca escolha um anúncio inconsistente")
  })

  it("still shows a mismatched listing so the model can omit it", () => {
    const mismatched = {
      ...RESULT,
      resultId: "r-shirt",
      searchTermId: "s-pants",
      jsonSearch: { ...RESULT.jsonSearch, term: "calça sarja reta casual" },
      jsonResult: { ...RESULT.jsonResult, title: "camiseta cinza" },
    }

    const prompt = buildAnalyzeScrapedResultsPrompt({
      locale: "pt-BR",
      panoramaContent: "panorama",
      routineDescription: null,
      results: [mismatched],
    })

    expect(prompt).toContain("Grupo s-pants (termo: calça sarja reta casual):")
    expect(prompt).toContain('"title":"camiseta cinza"')
    expect(prompt).toContain("termo de calça com um anúncio de camiseta")
  })
})
