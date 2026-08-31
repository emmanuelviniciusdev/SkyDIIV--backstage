import type { MarketplaceCatalogEntry } from "../db/marketplaces-catalog.repository"

export function selectEligibleMarketplaces(
  catalog: MarketplaceCatalogEntry[],
  locale: string,
): MarketplaceCatalogEntry[] {
  return catalog.filter((entry) => entry.supportedLanguages.includes(locale))
}

export function assignMarketplacesRoundRobin<T>(
  items: T[],
  marketplaces: MarketplaceCatalogEntry[],
): Array<{ item: T; marketplace: string }> {
  if (marketplaces.length === 0) return []

  return items.map((item, index) => {
    const marketplace = marketplaces[index % marketplaces.length]
    return {
      item,
      marketplace: marketplace?.name ?? "",
    }
  })
}
