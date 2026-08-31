import { describe, expect, it, vi } from "vitest"
import { SqlSearchTermsRepository } from "../../src/infrastructure/db/search-terms.repository.js"
import { SqlSearchResultsRepository } from "../../src/infrastructure/db/search-results.repository.js"
import { jsonSearchToSearchParams } from "../../src/infrastructure/scraping/json-search-to-params.js"

describe("SqlSearchTermsRepository.findUnprocessedGroupedByPanorama", () => {
  it("groups unprocessed terms by panorama", async () => {
    const db = vi.fn().mockResolvedValue([
      {
        id: "t1",
        wardrobe_panorama_id: "p1",
        marketplace: "enjoei",
        json_search: { term: "blazer", gender: "Female", topSize: "M", bottomSize: null, footSize: null },
      },
      {
        id: "t2",
        wardrobe_panorama_id: "p1",
        marketplace: "enjoei",
        json_search: { term: "tênis", gender: "Female", topSize: null, bottomSize: null, footSize: "38" },
      },
      {
        id: "t3",
        wardrobe_panorama_id: "p2",
        marketplace: "enjoei",
        json_search: { term: "saia", gender: null, topSize: null, bottomSize: null, footSize: null },
      },
    ])
    const repo = new SqlSearchTermsRepository(db as never)
    const groups = await repo.findUnprocessedGroupedByPanorama()
    expect(groups).toHaveLength(2)
    expect(groups[0]?.wardrobePanoramaId).toBe("p1")
    expect(groups[0]?.terms).toHaveLength(2)
    expect(groups[1]?.wardrobePanoramaId).toBe("p2")
  })
})

describe("jsonSearchToSearchParams", () => {
  it("maps json_search.term to searchTerm for Enjoei", () => {
    expect(
      jsonSearchToSearchParams({
        term: "blazer casual",
        gender: "Female",
        topSize: "M",
        bottomSize: null,
        footSize: null,
      }),
    ).toEqual({
      searchTerm: "blazer casual",
      gender: "Female",
      topSize: "M",
      bottomSize: null,
      footSize: null,
      brand: null,
    })
  })
})

describe("SqlSearchResultsRepository.insertResultsAndMarkProcessed", () => {
  it("caps inserts at 10 and always updates is_processed", async () => {
    const tx = vi.fn().mockResolvedValue([])
    Object.assign(tx, { json: (value: unknown) => value })
    const begin = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
    const writeDb = { begin } as never
    const repo = new SqlSearchResultsRepository(writeDb)

    const results = Array.from({ length: 12 }, (_, i) => ({
      marketplace: "enjoei",
      title: `item ${i}`,
      price: i,
      currency: "BRL",
      url: `https://example.com/${i}`,
      image_url: "https://img.example/1.jpg",
      metadata: {},
    }))

    await repo.insertResultsAndMarkProcessed({ searchTermId: "t1", results })

    const insertCalls = tx.mock.calls.filter((call) => {
      const first = call[0]
      return Array.isArray(first) && first.join(" ").includes("INSERT INTO results")
    })
    expect(insertCalls).toHaveLength(10)
    const sql = tx.mock.calls
      .flatMap((call) => (Array.isArray(call[0]) ? call[0] : []))
      .join(" ")
    expect(sql).toMatch(/is_processed = true/)
  })

  it("marks the term processed with zero result rows on empty scrape", async () => {
    const tx = vi.fn().mockResolvedValue([])
    Object.assign(tx, { json: (value: unknown) => value })
    const begin = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
    const repo = new SqlSearchResultsRepository({ begin } as never)

    await repo.insertResultsAndMarkProcessed({ searchTermId: "t1", results: [] })

    const insertCalls = tx.mock.calls.filter((call) => {
      const first = call[0]
      return Array.isArray(first) && first.join(" ").includes("INSERT INTO results")
    })
    expect(insertCalls).toHaveLength(0)
    expect(tx.mock.calls.some((call) => Array.isArray(call[0]) && call[0].join(" ").includes("UPDATE search_terms"))).toBe(true)
  })
})
