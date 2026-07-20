import type {
  MarketplaceScraperFactory,
  MarketplaceScraperPort,
} from "../../domain/ports/marketplace-scraper.port.js"

/**
 * Provider-pattern registry for marketplace scrapers.
 *
 * Resolution order: explicit `name` arg → registered key (case-insensitive).
 */
const registry = new Map<string, MarketplaceScraperFactory>()

export function registerMarketplaceScraper(
  name: string,
  factory: MarketplaceScraperFactory,
): void {
  registry.set(name.toLowerCase(), factory)
}

export function getMarketplaceScraper(name: string): MarketplaceScraperPort {
  const key = name.toLowerCase().trim()
  const factory = registry.get(key)
  if (!factory) {
    const available = [...registry.keys()].join(", ") || "(none)"
    throw new Error(
      `Marketplace scraper "${key}" is not registered. Available: ${available}`,
    )
  }
  return factory()
}

/** Clears the registry — intended for tests only. */
export function clearMarketplaceScrapers(): void {
  registry.clear()
}

export function listRegisteredMarketplaces(): string[] {
  return [...registry.keys()]
}
