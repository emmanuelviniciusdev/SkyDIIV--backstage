import type postgres from "postgres"
import { getOutboxCatchupMinAgeMinutes } from "../outbox-catchup-config"
import { randomUUID } from "crypto"

/** Catalog id for generate-search-terms-products-scraping + QStash (mirrors web EVENTS). */
export const GENERATE_SEARCH_TERMS_PRODUCTS_SCRAPING_EVENT_ID =
  "e60469c8-ec26-41ea-b366-06275211f372" as const

export const OUTBOX_CREATED_BY = "worker-scheduler" as const

/** A PENDING outbox event eligible for catch-up re-dispatch. */
export interface StaleOutboxEvent {
  outboxEventId: string
}

export interface StaleOutboxEventsQueryResult {
  minAgeMinutes: number
  events: StaleOutboxEvent[]
}

export interface OutboxEventsRepository {
  findPendingOlderThan(minAgeMinutes: number): Promise<StaleOutboxEvent[]>
  findStalePendingEvents(): Promise<StaleOutboxEventsQueryResult>
  insertGenerateSearchTerms(payload: { wardrobePanoramaId: string }): Promise<string>
}

interface PendingRow {
  id: string
}

/**
 * Queries PENDING outbox events whose created_at is older than the given age.
 */
export class SqlOutboxEventsRepository implements OutboxEventsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findPendingOlderThan(minAgeMinutes: number): Promise<StaleOutboxEvent[]> {
    const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000)

    const rows = await this.db<PendingRow[]>`
      SELECT id
      FROM outbox_events
      WHERE status = 'PENDING'
        AND created_at < ${cutoff}
      ORDER BY created_at ASC
    `

    return rows.map((row) => ({ outboxEventId: row.id }))
  }

  /**
   * Resolves OUTBOX_CATCHUP_MIN_AGE_MINUTES (falling back to the default when
   * unset or invalid) and queries matching PENDING outbox events.
   */
  async findStalePendingEvents(): Promise<StaleOutboxEventsQueryResult> {
    const minAgeMinutes = getOutboxCatchupMinAgeMinutes()
    const events = await this.findPendingOlderThan(minAgeMinutes)
    return { minAgeMinutes, events }
  }

  async insertGenerateSearchTerms(payload: { wardrobePanoramaId: string }): Promise<string> {
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
        ${GENERATE_SEARCH_TERMS_PRODUCTS_SCRAPING_EVENT_ID},
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
