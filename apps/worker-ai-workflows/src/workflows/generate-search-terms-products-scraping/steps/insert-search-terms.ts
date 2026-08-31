import { getWriteDb } from "../../../lib/db/client"
import {
  SqlSearchTermsScrapedProductsRepository,
  type InsertSearchTermInput,
} from "../../../lib/db/search-terms-scraped-products.repository"
import { assignMarketplacesRoundRobin } from "../../../lib/automatic-thrifting/marketplace-eligibility"
import { composeSearchParams } from "../../../lib/shopping/compose-search-params"
import type { MarketplaceCatalogEntry } from "../../../lib/db/marketplaces-catalog.repository"
import type { ParsedSearchTermSuggestion } from "../../../lib/shopping/suggestions"
import type { ShoppingSuggestionsPreferences } from "../../../lib/db/shopping-suggestions-preferences.repository"
import { createLogger } from "../../../lib/logger"

export interface InsertSearchTermsInput {
  wardrobePanoramaId: string
  llmInteractionId: string
  suggestions: ParsedSearchTermSuggestion[]
  shoppingPreferences: ShoppingSuggestionsPreferences | null
  eligibleMarketplaces: MarketplaceCatalogEntry[]
}

export async function insertSearchTermsStep(input: InsertSearchTermsInput): Promise<number> {
  const log = createLogger("insert-search-terms")
  const jsonSearches = composeSearchParams(input.suggestions, input.shoppingPreferences)
  const assigned = assignMarketplacesRoundRobin(jsonSearches, input.eligibleMarketplaces)

  const rows: InsertSearchTermInput[] = assigned.map(({ item, marketplace }) => ({
    wardrobePanoramaId: input.wardrobePanoramaId,
    llmInteractionId: input.llmInteractionId,
    marketplace,
    jsonSearch: item,
  }))

  const repo = new SqlSearchTermsScrapedProductsRepository(getWriteDb())
  await repo.insertMany(rows)

  log.info("Inserted search terms", {
    wardrobePanoramaId: input.wardrobePanoramaId,
    count: rows.length,
  })

  return rows.length
}
