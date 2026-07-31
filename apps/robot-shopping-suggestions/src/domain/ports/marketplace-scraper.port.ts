import type { ScrapedProduct } from "../entities/scraped-product.js"
import type { SearchParams } from "../entities/search-params.js"

/**
 * Input for a marketplace scrape operation.
 */
export interface MarketplaceScrapeInput {
  searchParams: SearchParams[]
  userId: string
}

/**
 * Port for scraping clothing items from a specific marketplace.
 * Implementations are registered via the marketplace scraper provider.
 */
export interface MarketplaceScraperPort {
  /** Marketplace key this scraper handles (e.g. "enjoei"). */
  readonly marketplace: string

  /**
   * Scrapes clothing suggestions for the given search params.
   * Must apply human-like delays between requests internally.
   */
  scrape(input: MarketplaceScrapeInput): Promise<ScrapedProduct[]>
}

export type MarketplaceScraperFactory = () => MarketplaceScraperPort
