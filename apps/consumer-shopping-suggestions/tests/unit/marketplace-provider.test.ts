import { afterEach, describe, expect, it } from "vitest"
import {
  clearMarketplaceScrapers,
  getMarketplaceScraper,
  listRegisteredMarketplaces,
  registerMarketplaceScraper,
} from "../../src/infrastructure/scraping/marketplace-scraper.provider.js"
import type { MarketplaceScraperPort } from "../../src/domain/ports/marketplace-scraper.port.js"

afterEach(() => {
  clearMarketplaceScrapers()
})

describe("marketplace scraper provider", () => {
  it("registers and resolves scrapers case-insensitively", () => {
    const scraper: MarketplaceScraperPort = {
      marketplace: "enjoei",
      scrape: async () => [],
    }
    registerMarketplaceScraper("enjoei", () => scraper)

    expect(getMarketplaceScraper("Enjoei")).toBe(scraper)
    expect(listRegisteredMarketplaces()).toEqual(["enjoei"])
  })

  it("throws for unknown marketplaces", () => {
    expect(() => getMarketplaceScraper("zara")).toThrow(/not registered/)
  })
})
