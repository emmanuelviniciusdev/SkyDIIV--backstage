import type { MarketplaceCatalogEntry } from "../db/marketplaces-catalog.repository"
import { isLocale, type Locale } from "../i18n/config"

export function selectEligibleMarketplaces(
  catalog: MarketplaceCatalogEntry[],
): MarketplaceCatalogEntry[] {
  return catalog.filter((entry) => entry.supportedLanguages.length > 0)
}

/**
 * Use the user's locale when a marketplace lists it; otherwise use a
 * marketplace-supported language.
 */
export function resolveSearchTermsLocale(
  userLocale: Locale,
  marketplaces: MarketplaceCatalogEntry[],
): Locale {
  const supported = marketplaces.flatMap((entry) => entry.supportedLanguages)
  if (supported.includes(userLocale)) return userLocale
  const marketplaceLanguage = supported.find(isLocale)
  return marketplaceLanguage ?? userLocale
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
