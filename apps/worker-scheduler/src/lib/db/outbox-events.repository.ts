import type postgres from "postgres"
import { getOutboxCatchupMinAgeMinutes } from "../outbox-catchup-config"

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
}
