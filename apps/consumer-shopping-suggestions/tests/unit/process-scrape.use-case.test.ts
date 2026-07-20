import { describe, expect, it, vi } from "vitest"
import { ProcessScrapeShoppingSuggestionsUseCase } from "../../src/application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import type { MarketplaceScraperPort } from "../../src/domain/ports/marketplace-scraper.port.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("ProcessScrapeShoppingSuggestionsUseCase", () => {
  it("resolves the scraper and returns scraped products", async () => {
    const scrape = vi.fn().mockResolvedValue([
      {
        marketplace: "enjoei",
        title: "Vestido Midi",
        price: 89.9,
        currency: "BRL",
        url: "https://www.enjoei.com.br/p/vestido",
        imageUrl: null,
        searchTerm: "vestido",
      },
    ])

    const scraper: MarketplaceScraperPort = {
      marketplace: "enjoei",
      scrape,
    }

    const resolveScraper = vi.fn().mockReturnValue(scraper)
    const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
      resolveScraper,
      logger: silentLogger(),
    })

    const result = await useCase.execute({
      marketplace: "Enjoei",
      userid: "user-42",
      search_terms: ["vestido"],
    })

    expect(resolveScraper).toHaveBeenCalledWith("enjoei")
    expect(scrape).toHaveBeenCalledWith({
      searchTerms: ["vestido"],
      userId: "user-42",
    })
    expect(result.products).toHaveLength(1)
    expect(result.userId).toBe("user-42")
    expect(result.marketplace).toBe("enjoei")
  })

  it("propagates scraper resolution errors", async () => {
    const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
      resolveScraper: () => {
        throw new Error('Marketplace scraper "unknown" is not registered')
      },
      logger: silentLogger(),
    })

    await expect(
      useCase.execute({
        marketplace: "unknown",
        userid: "u1",
        search_terms: ["x"],
      }),
    ).rejects.toThrow(/not registered/)
  })
})
