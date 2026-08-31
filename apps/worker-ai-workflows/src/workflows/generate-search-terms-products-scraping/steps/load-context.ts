import { getReadDb } from "../../../lib/db/client"
import { SqlWardrobePanoramaRepository } from "../../../lib/db/wardrobe-panorama.repository"
import { SqlPreferencesRepository } from "../../../lib/db/preferences.repository"
import { SqlShoppingSuggestionsPreferencesRepository } from "../../../lib/db/shopping-suggestions-preferences.repository"
import { SqlMarketplacesCatalogRepository } from "../../../lib/db/marketplaces-catalog.repository"
import type { MarketplaceCatalogEntry } from "../../../lib/db/marketplaces-catalog.repository"
import type { ShoppingSuggestionsPreferences } from "../../../lib/db/shopping-suggestions-preferences.repository"
import { resolveUserLocale, type Locale } from "../../../lib/i18n"
import { selectEligibleMarketplaces } from "../../../lib/automatic-thrifting/marketplace-eligibility"
import { createLogger } from "../../../lib/logger"

export interface LoadGenerateSearchTermsContextResult {
  wardrobePanoramaId: string
  userId: string
  locale: Locale
  panoramaContent: string
  routineDescription: string | null
  shoppingPreferences: ShoppingSuggestionsPreferences | null
  eligibleMarketplaces: MarketplaceCatalogEntry[]
}

export async function loadGenerateSearchTermsContextStep(
  wardrobePanoramaId: string,
): Promise<LoadGenerateSearchTermsContextResult> {
  const log = createLogger("load-generate-search-terms-context")
  const db = getReadDb()
  const panoramaRepo = new SqlWardrobePanoramaRepository(db, db)
  const preferencesRepo = new SqlPreferencesRepository(db)
  const shoppingPrefsRepo = new SqlShoppingSuggestionsPreferencesRepository(db)
  const catalogRepo = new SqlMarketplacesCatalogRepository(db)

  const panorama = await panoramaRepo.findById(wardrobePanoramaId)
  if (!panorama) {
    throw new Error(`wardrobe_panorama not found: ${wardrobePanoramaId}`)
  }

  const [locale, preferences, shoppingPreferences, catalog] = await Promise.all([
    resolveUserLocale(panorama.userId),
    preferencesRepo.findByUserId(panorama.userId),
    shoppingPrefsRepo.findByUserId(panorama.userId),
    catalogRepo.findAll(),
  ])

  const eligibleMarketplaces = selectEligibleMarketplaces(catalog, locale)

  log.info("Loaded generate-search-terms context", {
    wardrobePanoramaId,
    userId: panorama.userId,
    locale,
    eligibleMarketplaceCount: eligibleMarketplaces.length,
    hasRoutine: Boolean(preferences?.routineDescription),
    hasShoppingPreferences: shoppingPreferences !== null,
  })

  return {
    wardrobePanoramaId,
    userId: panorama.userId,
    locale,
    panoramaContent: panorama.content,
    routineDescription: preferences?.routineDescription ?? null,
    shoppingPreferences,
    eligibleMarketplaces,
  }
}
