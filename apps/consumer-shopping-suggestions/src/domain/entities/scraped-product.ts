/**
 * A clothing item scraped from a marketplace search result page.
 */
export interface ScrapedProduct {
  marketplace: string
  title: string
  price: number | null
  currency: string | null
  url: string
  imageUrl: string | null
  searchTerm: string
}

/**
 * Aggregate result of scraping one or more search terms on a marketplace.
 */
export interface ScrapeResult {
  marketplace: string
  userId: string
  products: ScrapedProduct[]
  scrapedAt: Date
}
