import { describe, expect, it, vi } from "vitest"
import { ProcessScrapeShoppingSuggestionsUseCase } from "../../src/application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import type { CachePort } from "../../src/domain/ports/cache.port.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import type { MarketplaceScraperPort } from "../../src/domain/ports/marketplace-scraper.port.js"
import type { ScrapedProductsRepositoryPort } from "../../src/domain/ports/scraped-products.repository.port.js"
import type { WardrobePanoramaRepositoryPort } from "../../src/domain/ports/wardrobe-panorama.repository.port.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createDeps(overrides?: {
  resolveScraper?: (marketplace: string) => MarketplaceScraperPort
  panoramaId?: string | null
  scrapeError?: Error
}) {
  const scrape = overrides?.scrapeError
    ? vi.fn().mockRejectedValue(overrides.scrapeError)
    : vi.fn().mockResolvedValue([
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

  const findIdByUserId = vi
    .fn()
    .mockResolvedValue(overrides?.panoramaId === undefined ? "panorama-1" : overrides.panoramaId)
  const findClothingItemProductTypeId = vi.fn().mockResolvedValue("product-type-1")
  const replaceForPanorama = vi.fn().mockResolvedValue(undefined)
  const invalidateShoppingSuggestions = vi.fn().mockResolvedValue(undefined)
  const setNewShoppingSuggestionsNotification = vi.fn().mockResolvedValue(undefined)

  const wardrobePanoramaRepository: WardrobePanoramaRepositoryPort = {
    findIdByUserId,
  }

  const scrapedProductsRepository: ScrapedProductsRepositoryPort = {
    findClothingItemProductTypeId,
    replaceForPanorama,
  }

  const cache: CachePort = {
    invalidateShoppingSuggestions,
    setNewShoppingSuggestionsNotification,
  }

  const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
    resolveScraper: overrides?.resolveScraper ?? vi.fn().mockReturnValue(scraper),
    wardrobePanoramaRepository,
    scrapedProductsRepository,
    cache,
    logger: silentLogger(),
  })

  return {
    useCase,
    scrape,
    replaceForPanorama,
    invalidateShoppingSuggestions,
    setNewShoppingSuggestionsNotification,
  }
}

describe("ProcessScrapeShoppingSuggestionsUseCase", () => {
  it("scrapes, replaces products with SUCCESS, invalidates cache, and sets notification", async () => {
    const {
      useCase,
      scrape,
      replaceForPanorama,
      invalidateShoppingSuggestions,
      setNewShoppingSuggestionsNotification,
    } = createDeps()

    const result = await useCase.execute({
      marketplace: "Enjoei",
      userid: "user-42",
      search_terms: ["vestido"],
    })

    expect(scrape).toHaveBeenCalledWith({
      searchTerms: ["vestido"],
      userId: "user-42",
    })
    expect(result.products).toHaveLength(1)
    expect(result.userId).toBe("user-42")
    expect(result.marketplace).toBe("enjoei")

    expect(replaceForPanorama).toHaveBeenCalledWith({
      wardrobePanoramaId: "panorama-1",
      productTypeId: "product-type-1",
      products: [
        expect.objectContaining({
          marketplace: "enjoei",
          title: "Vestido Midi",
          price: 89.9,
          currency: "BRL",
          url: "https://www.enjoei.com.br/p/vestido",
          imageUrl: "https://assets.skydiiv.space/placeholder--scraped-product.png",
          searchTerm: "vestido",
          scrapingStatus: "SUCCESS",
          scrapingMetadata: expect.objectContaining({
            marketplace: "enjoei",
            searchTerm: "vestido",
            raw: expect.objectContaining({
              price: 89.9,
              imageUrl: null,
            }),
          }),
        }),
      ],
    })

    expect(invalidateShoppingSuggestions).toHaveBeenCalledWith("user-42")
    expect(setNewShoppingSuggestionsNotification).toHaveBeenCalledWith("user-42")
  })

  it("throws when the user has no wardrobe panorama", async () => {
    const { useCase, scrape, replaceForPanorama } = createDeps({ panoramaId: null })

    await expect(
      useCase.execute({
        marketplace: "enjoei",
        userid: "user-missing",
        search_terms: ["vestido"],
      }),
    ).rejects.toThrow(/panorama not found/)

    expect(scrape).not.toHaveBeenCalled()
    expect(replaceForPanorama).not.toHaveBeenCalled()
  })

  it("persists ERROR rows and invalidates cache when scraping fails", async () => {
    const scrapeError = new Error("browser crashed")
    const {
      useCase,
      replaceForPanorama,
      invalidateShoppingSuggestions,
      setNewShoppingSuggestionsNotification,
    } = createDeps({ scrapeError })

    const result = await useCase.execute({
      marketplace: "enjoei",
      userid: "user-42",
      search_terms: ["vestido", "jaqueta"],
    })

    expect(result.products).toEqual([])
    expect(replaceForPanorama).toHaveBeenCalledWith({
      wardrobePanoramaId: "panorama-1",
      productTypeId: "product-type-1",
      products: [
        expect.objectContaining({
          searchTerm: "vestido",
          scrapingStatus: "ERROR",
          imageUrl: "https://assets.skydiiv.space/placeholder--scraped-product.png",
          scrapingMetadata: expect.objectContaining({
            error: expect.objectContaining({ message: "browser crashed" }),
          }),
        }),
        expect.objectContaining({
          searchTerm: "jaqueta",
          scrapingStatus: "ERROR",
        }),
      ],
    })

    expect(invalidateShoppingSuggestions).toHaveBeenCalledWith("user-42")
    expect(setNewShoppingSuggestionsNotification).not.toHaveBeenCalled()
  })

  it("persists ERROR rows when scraper resolution fails (no throw)", async () => {
    const { useCase, replaceForPanorama } = createDeps({
      resolveScraper: () => {
        throw new Error('Marketplace scraper "unknown" is not registered')
      },
    })

    const result = await useCase.execute({
      marketplace: "unknown",
      userid: "u1",
      search_terms: ["x"],
    })

    expect(result.products).toEqual([])
    expect(replaceForPanorama).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          expect.objectContaining({
            scrapingStatus: "ERROR",
            searchTerm: "x",
          }),
        ],
      }),
    )
  })
})
