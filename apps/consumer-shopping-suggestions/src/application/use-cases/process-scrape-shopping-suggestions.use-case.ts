import type { ScrapeResult } from "../../domain/entities/scraped-product.js"
import type { ScrapeShoppingSuggestionsPayload } from "../../domain/events/scrape-shopping-suggestions.event.js"
import type { Logger } from "../../domain/ports/logger.port.js"
import type { MarketplaceScraperPort } from "../../domain/ports/marketplace-scraper.port.js"

export type MarketplaceScraperResolver = (marketplace: string) => MarketplaceScraperPort

export interface ProcessScrapeShoppingSuggestionsDeps {
  resolveScraper: MarketplaceScraperResolver
  logger: Logger
}

/**
 * Application use case: scrape clothing suggestions for a user on a marketplace.
 *
 * Output handling is intentionally deferred — see TODO below.
 */
export class ProcessScrapeShoppingSuggestionsUseCase {
  constructor(private readonly deps: ProcessScrapeShoppingSuggestionsDeps) {}

  async execute(payload: ScrapeShoppingSuggestionsPayload): Promise<ScrapeResult> {
    const marketplace = payload.marketplace.toLowerCase().trim()
    const scraper = this.deps.resolveScraper(marketplace)

    this.deps.logger.info("Starting marketplace scrape", {
      marketplace,
      userId: payload.userid,
      searchTermCount: payload.search_terms.length,
    })

    const products = await scraper.scrape({
      searchTerms: payload.search_terms,
      userId: payload.userid,
    })

    const result: ScrapeResult = {
      marketplace,
      userId: payload.userid,
      products,
      scrapedAt: new Date(),
    }

    this.deps.logger.info("Marketplace scrape completed", {
      marketplace,
      userId: payload.userid,
      productCount: products.length,
    })

    this.deps.logger.debug("Scrape output", {
      marketplace,
      userId: payload.userid,
      scrapedAt: result.scrapedAt.toISOString(),
      searchTerms: payload.search_terms,
      productCount: products.length,
      products,
    })

    // TODO: Persist / publish scrape output (e.g. store suggestions, enqueue
    // downstream ranking, notify the user). Left intentionally empty for now.
    void result

    return result
  }
}
