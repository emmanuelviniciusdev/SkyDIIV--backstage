import { randomUUID } from "node:crypto"
import type postgres from "postgres"

/** Catalog id for analyze-scraped-products-results + QStash (mirrors web EVENTS). */
export const ANALYZE_SCRAPED_PRODUCTS_RESULTS_EVENT_ID =
  "fc7bb17a-a63c-48f4-b80e-da224c06367f" as const

export const OUTBOX_CREATED_BY = "robot-scrape-products" as const

export class SqlOutboxEventsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async insertAnalyzeScrapedProductsResults(payload: {
    wardrobePanoramaId: string
  }): Promise<string> {
    const id = randomUUID()
    await this.db`
      INSERT INTO outbox_events (
        id,
        event_id,
        payload,
        status,
        created_by,
        updated_by,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${ANALYZE_SCRAPED_PRODUCTS_RESULTS_EVENT_ID},
        ${this.db.json(payload)},
        ${"PENDING"},
        ${OUTBOX_CREATED_BY},
        ${OUTBOX_CREATED_BY},
        NOW(),
        NOW()
      )
    `
    return id
  }
}
