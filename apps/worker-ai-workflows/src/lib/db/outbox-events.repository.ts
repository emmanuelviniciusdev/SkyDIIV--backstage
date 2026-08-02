import { randomUUID } from "crypto"
import type postgres from "postgres"

/** Catalog id for scrape-shopping-suggestions + CF Queues (mirrors web EVENTS). */
export const SCRAPE_SHOPPING_SUGGESTIONS_EVENT_ID =
  "22526aec-2fc1-4734-baf7-1dfe04e45c19" as const

export const OUTBOX_CREATED_BY = "worker-ai-workflows" as const

export interface ScrapeShoppingSuggestionsOutboxPayload {
  marketplace: string
  userId: string
  searchParams: Array<{
    searchTerm: string
    gender: string | null
    topSize: string | null
    bottomSize: string | null
    footSize: string | null
    brand: string | null
  }>
}

export interface OutboxEventsRepository {
  insertScrapeShoppingSuggestions(
    payload: ScrapeShoppingSuggestionsOutboxPayload,
  ): Promise<string>
}

export class SqlOutboxEventsRepository implements OutboxEventsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async insertScrapeShoppingSuggestions(
    payload: ScrapeShoppingSuggestionsOutboxPayload,
  ): Promise<string> {
    // Prisma @default(uuid()) is app-side only — raw SQL must supply id.
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
        ${SCRAPE_SHOPPING_SUGGESTIONS_EVENT_ID},
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
