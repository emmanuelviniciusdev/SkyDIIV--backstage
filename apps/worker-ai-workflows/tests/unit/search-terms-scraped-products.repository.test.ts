import { describe, it, expect, vi } from "vitest"
import type postgres from "postgres"
import { SqlSearchTermsScrapedProductsRepository } from "../../src/lib/db/search-terms-scraped-products.repository"
import { SqlMarketplacesCatalogRepository } from "../../src/lib/db/marketplaces-catalog.repository"
import { SqlWardrobePanoramaRepository } from "../../src/lib/db/wardrobe-panorama.repository"

function makeSqlMock(rows: unknown[] = []): postgres.Sql & ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql & ReturnType<typeof vi.fn>
}

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
      return []
    })
    .join(" ")
}

describe("SqlSearchTermsScrapedProductsRepository", () => {
  it("existsUnprocessedForPanorama queries is_processed = false for the panorama", async () => {
    const db = makeSqlMock([{ has_unprocessed: true }])
    const repo = new SqlSearchTermsScrapedProductsRepository(db)

    await expect(repo.existsUnprocessedForPanorama("p1")).resolves.toBe(true)

    const sql = getSqlStrings(db)
    expect(sql).toMatch(/search_terms_scraped_products/)
    expect(sql).toMatch(/wardrobe_panorama_id/)
    expect(sql).toMatch(/is_processed/)
    expect(db.mock.calls[0]?.[1]).toBe("p1")
  })

  it("existsUnprocessedForPanorama returns false when none exist", async () => {
    const db = makeSqlMock([{ has_unprocessed: false }])
    const repo = new SqlSearchTermsScrapedProductsRepository(db)
    await expect(repo.existsUnprocessedForPanorama("p1")).resolves.toBe(false)
  })

  it("insertMany writes is_processed false and does not delete products/terms/results", async () => {
    const db = makeSqlMock([])
    const json = vi.fn((value: unknown) => value)
    Object.assign(db, { json })
    const repo = new SqlSearchTermsScrapedProductsRepository(db)

    await repo.insertMany([
      {
        wardrobePanoramaId: "p1",
        llmInteractionId: "llm-1",
        marketplace: "enjoei",
        jsonSearch: {
          term: "blazer casual",
          gender: "Female",
          topSize: "M",
          bottomSize: null,
          footSize: null,
        },
      },
    ])

    const sql = getSqlStrings(db)
    expect(sql).toMatch(/INSERT INTO search_terms_scraped_products/)
    expect(sql).not.toMatch(/DELETE/i)
    expect(sql).not.toMatch(/FROM scraped_products/)
    expect(sql).not.toMatch(/results_search_terms_scraped_products/)
  })

  it("insertMany is a no-op for an empty list", async () => {
    const db = makeSqlMock([])
    const repo = new SqlSearchTermsScrapedProductsRepository(db)
    await repo.insertMany([])
    expect(db).not.toHaveBeenCalled()
  })
})

describe("SqlMarketplacesCatalogRepository", () => {
  it("maps supported_languages arrays", async () => {
    const db = makeSqlMock([
      { id: "m1", name: "enjoei", supported_languages: ["pt-BR"] },
    ])
    const repo = new SqlMarketplacesCatalogRepository(db)
    await expect(repo.findAll()).resolves.toEqual([
      { id: "m1", name: "enjoei", supportedLanguages: ["pt-BR"] },
    ])
    expect(getSqlStrings(db)).toMatch(/marketplaces_catalog_scraped_products/)
  })
})

describe("SqlWardrobePanoramaRepository.findById", () => {
  it("selects panorama by id", async () => {
    const db = makeSqlMock([{ id: "p1", user_id: "u1", content: "## panorama" }])
    const repo = new SqlWardrobePanoramaRepository(db, db)
    await expect(repo.findById("p1")).resolves.toEqual({
      id: "p1",
      userId: "u1",
      content: "## panorama",
    })
    expect(getSqlStrings(db)).toMatch(/FROM wardrobe_panorama/)
  })
})
