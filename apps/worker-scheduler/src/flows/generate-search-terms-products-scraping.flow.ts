import { getDb } from "../lib/db/client"
import { SqlWardrobePanoramaIdsRepository } from "../lib/db/wardrobe-panorama-ids.repository"
import { SqlOutboxEventsRepository } from "../lib/db/outbox-events.repository"
import { dispatchStaleOutboxEvents } from "./catch-up-outbox-events.flow"
import { createLogger } from "../lib/logger"
import type { FlowResult, ScheduleFlow } from "./types"

export interface GenerateSearchTermsProductsScrapingPayload {
  wardrobePanoramaId: string
}

/**
 * Inserts one PENDING generate-search-terms-products-scraping outbox row per
 * wardrobe panorama, then batch-publishes { outboxEventId } to worker-outbox-events.
 *
 * Insert failure is fatal. QStash failure after insert is non-fatal (PENDING
 * rows are retried by catch-up).
 */
export async function insertAndPublishGenerateSearchTerms(
  panoramaIds: string[],
): Promise<{ inserted: number; published: number }> {
  if (panoramaIds.length === 0) return { inserted: 0, published: 0 }

  const log = createLogger("generate-search-terms-products-scraping-flow")
  const db = getDb()
  const repo = new SqlOutboxEventsRepository(db)

  const outboxEventIds: string[] = []
  for (const wardrobePanoramaId of panoramaIds) {
    const outboxEventId = await repo.insertGenerateSearchTerms({ wardrobePanoramaId })
    outboxEventIds.push(outboxEventId)
  }

  try {
    const published = await dispatchStaleOutboxEvents(
      outboxEventIds.map((outboxEventId) => ({ outboxEventId })),
    )
    return { inserted: outboxEventIds.length, published }
  } catch (err) {
    log.warn("Failed to publish outbox events to QStash — catch-up will retry", {
      inserted: outboxEventIds.length,
      error: err instanceof Error ? err.message : String(err),
    })
    return { inserted: outboxEventIds.length, published: 0 }
  }
}

export const generateSearchTermsProductsScrapingFlow: ScheduleFlow = {
  name: "generate-search-terms-products-scraping",

  async run(): Promise<FlowResult> {
    const log = createLogger("generate-search-terms-products-scraping-flow")
    const db = getDb()
    const idsRepo = new SqlWardrobePanoramaIdsRepository(db)
    const panoramaIds = await idsRepo.findAllIds()
    log.info("Wardrobe panorama ids fetched", { count: panoramaIds.length })

    const { inserted, published } = await insertAndPublishGenerateSearchTerms(panoramaIds)
    log.info("Generate-search-terms dispatch complete", { inserted, published })

    return { flow: this.name, dispatched: inserted }
  },
}
