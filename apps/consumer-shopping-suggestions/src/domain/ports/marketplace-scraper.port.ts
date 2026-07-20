import type { ScrapedProduct } from "../entities/scraped-product.js"

/**
 * Input for a marketplace scrape operation.
 */
export interface MarketplaceScrapeInput {
  searchTerms: string[]
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
   * Scrapes clothing suggestions for the given search terms.
   * Must apply human-like delays between requests internally.
   */
  scrape(input: MarketplaceScrapeInput): Promise<ScrapedProduct[]>
}

export type MarketplaceScraperFactory = () => MarketplaceScraperPort
