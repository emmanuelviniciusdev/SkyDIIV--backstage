import { getReadDb } from "../../../lib/db/client"
import { SqlWardrobePanoramaRepository } from "../../../lib/db/wardrobe-panorama.repository"
import { SqlPreferencesRepository } from "../../../lib/db/preferences.repository"
import {
  SqlScrapedProductsSwapRepository,
  type UnprocessedScrapeResult,
} from "../../../lib/db/scraped-products-swap.repository"
import { resolveUserLocale, type Locale } from "../../../lib/i18n"
import { createLogger } from "../../../lib/logger"

export interface LoadAnalyzeContextResult {
  wardrobePanoramaId: string
  userId: string
  locale: Locale
  panoramaContent: string
  routineDescription: string | null
  results: UnprocessedScrapeResult[]
}

export async function loadAnalyzeContextStep(
  wardrobePanoramaId: string,
): Promise<LoadAnalyzeContextResult> {
  const log = createLogger("load-analyze-context")
  const db = getReadDb()
  const panoramaRepo = new SqlWardrobePanoramaRepository(db, db)
  const preferencesRepo = new SqlPreferencesRepository(db)
  const swapRepo = new SqlScrapedProductsSwapRepository(db)

  const panorama = await panoramaRepo.findById(wardrobePanoramaId)
  if (!panorama) {
    throw new Error(`wardrobe_panorama not found: ${wardrobePanoramaId}`)
  }

  const [locale, preferences, results] = await Promise.all([
    resolveUserLocale(panorama.userId),
    preferencesRepo.findByUserId(panorama.userId),
    swapRepo.findUnprocessedResultsForPanorama(wardrobePanoramaId),
  ])

  log.info("Loaded analyze context", {
    wardrobePanoramaId,
    userId: panorama.userId,
    resultCount: results.length,
  })

  return {
    wardrobePanoramaId,
    userId: panorama.userId,
    locale,
    panoramaContent: panorama.content,
    routineDescription: preferences?.routineDescription ?? null,
    results,
  }
}
