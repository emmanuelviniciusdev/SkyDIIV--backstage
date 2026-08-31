import { describe, it, expect, vi } from "vitest"
import type postgres from "postgres"
import { SqlScrapedProductsSwapRepository } from "../../src/lib/db/scraped-products-swap.repository"

type SqlMock = ReturnType<typeof vi.fn> & {
  begin?: ReturnType<typeof vi.fn>
  json?: (value: unknown) => unknown
}

function makeWriteDb(): { db: postgres.Sql; tx: ReturnType<typeof vi.fn>; begin: ReturnType<typeof vi.fn> } {
  const tx = vi.fn().mockImplementation((first: unknown) => {
    if (Array.isArray(first) && !Object.prototype.hasOwnProperty.call(first, "raw")) {
      return first
    }
    return Promise.resolve([{ id: "domain-1" }])
  })
  Object.assign(tx, { json: (value: unknown) => value })

  const db = vi.fn().mockResolvedValue([{ id: "domain-1" }]) as unknown as SqlMock
  db.json = (value: unknown) => value
  const begin = vi.fn().mockImplementation(async (fn: (t: ReturnType<typeof vi.fn>) => Promise<unknown>) => {
    return await fn(tx)
  })
  db.begin = begin
  return { db: db as unknown as postgres.Sql, tx, begin }
}

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw")) {
        return first.filter((s): s is string => typeof s === "string")
      }
      return []
    })
    .join(" ")
}

function getInterpolatedValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw")) {
      return call.slice(1)
    }
    return []
  })
}

const PRODUCT = {
  marketplace: "enjoei",
  title: "Blazer bege",
  price: 80,
  currency: "BRL",
  url: "https://www.enjoei.com.br/p/1",
  imageUrl: "https://img.example/1.jpg",
  searchTerm: "blazer casual",
  scrapingMetadata: { marketplace: "enjoei" },
}

describe("SqlScrapedProductsSwapRepository.swapForPanorama", () => {
  it("is a no-op when the product list is empty", async () => {
    const { db, begin } = makeWriteDb()
    const repo = new SqlScrapedProductsSwapRepository(db)
    await repo.swapForPanorama({ wardrobePanoramaId: "p1", products: [] })
    expect(begin).not.toHaveBeenCalled()
  })

  it("deletes then inserts then deletes related results and terms only for that panorama", async () => {
    const { db, tx, begin } = makeWriteDb()
    const repo = new SqlScrapedProductsSwapRepository(db)

    await repo.swapForPanorama({ wardrobePanoramaId: "p1", products: [PRODUCT] })

    expect(begin).toHaveBeenCalledOnce()
    const sql = getSqlStrings(tx)
    expect(sql).toMatch(/DELETE FROM scraped_products/)
    expect(sql).toMatch(/INSERT INTO scraped_products/)
    expect(sql).toMatch(/DELETE FROM results_search_terms_scraped_products/)
    expect(sql).toMatch(/DELETE FROM search_terms_scraped_products/)
    expect(getInterpolatedValues(tx)).toContain("p1")
    expect(getInterpolatedValues(tx)).not.toContain("p2")
  })
})
