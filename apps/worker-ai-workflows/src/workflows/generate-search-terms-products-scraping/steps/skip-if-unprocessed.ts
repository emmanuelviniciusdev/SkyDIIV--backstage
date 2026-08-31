import { getReadDb } from "../../../lib/db/client"
import { SqlSearchTermsScrapedProductsRepository } from "../../../lib/db/search-terms-scraped-products.repository"
import { createLogger } from "../../../lib/logger"

export async function skipIfUnprocessedSearchTermsStep(
  wardrobePanoramaId: string,
): Promise<boolean> {
  const log = createLogger("skip-if-unprocessed-search-terms")
  const repo = new SqlSearchTermsScrapedProductsRepository(getReadDb())
  const exists = await repo.existsUnprocessedForPanorama(wardrobePanoramaId)
  if (exists) {
    log.info("Unprocessed search terms already exist — skipping generate", {
      wardrobePanoramaId,
    })
  }
  return exists
}
