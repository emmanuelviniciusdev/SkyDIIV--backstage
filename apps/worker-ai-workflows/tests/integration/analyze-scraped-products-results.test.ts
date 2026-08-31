import { describe, it, expect, vi } from "vitest"
import { parseWardrobePanoramaIdPayload } from "../../src/lib/automatic-thrifting/payload"
import { parseAnalyzeResultsLlmOutput } from "../../src/lib/prompt/analyze-results-response"
import { buildChosenProductInserts } from "../../src/workflows/analyze-scraped-products-results/steps/map-chosen-listings"
import { SqlScrapedProductsSwapRepository } from "../../src/lib/db/scraped-products-swap.repository"

const mocks = vi.hoisted(() => {
  const writeDb = vi.fn()
  const begin = vi.fn()
  Object.assign(writeDb, {
    json: (value: unknown) => value,
    begin,
  })
  return { writeDb, begin }
})

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.writeDb,
  getWriteDb: () => mocks.writeDb,
  resetDbClients: vi.fn(),
}))

describe("analyze-scraped-products-results", () => {
  it("fails a missing panorama id without deletes", () => {
    expect(() => parseWardrobePanoramaIdPayload({ wardrobePanoramaId: "" })).toThrow(
      /wardrobePanoramaId/,
    )
    expect(mocks.begin).not.toHaveBeenCalled()
  })

  it("maps zero LLM selections to an empty insert list so last week is kept", () => {
    const products = buildChosenProductInserts([], [
      {
        resultId: "r1",
        searchTermId: "s1",
        marketplace: "enjoei",
        jsonSearch: { term: "blazer" },
        jsonResult: {
          marketplace: "enjoei",
          title: "Blazer",
          price: 10,
          currency: "BRL",
          url: "https://example.com/p",
          image_url: "https://img.example/1.jpg",
          metadata: {},
        },
      },
    ])
    expect(products).toEqual([])
  })

  it("maps one chosen listing per search term", () => {
    const chosen = parseAnalyzeResultsLlmOutput(
      JSON.stringify([{ searchTermScrapedProductId: "s1", resultId: "r1" }]),
    )
    const products = buildChosenProductInserts(chosen, [
      {
        resultId: "r1",
        searchTermId: "s1",
        marketplace: "enjoei",
        jsonSearch: { term: "blazer casual" },
        jsonResult: {
          marketplace: "enjoei",
          title: "Blazer bege",
          price: 80,
          currency: "BRL",
          url: "https://www.enjoei.com.br/p/1",
          image_url: "https://img.example/1.jpg",
          metadata: { foo: "bar" },
        },
      },
    ])
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      title: "Blazer bege",
      searchTerm: "blazer casual",
      marketplace: "enjoei",
    })
  })

  it("swapForPanorama does not begin a transaction when the insert list is empty", async () => {
    const repo = new SqlScrapedProductsSwapRepository(mocks.writeDb as never)
    await repo.swapForPanorama({ wardrobePanoramaId: "p1", products: [] })
    expect(mocks.begin).not.toHaveBeenCalled()
  })
})
