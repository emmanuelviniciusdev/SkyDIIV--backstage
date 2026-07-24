import type postgres from "postgres"

export const UPDATED_BY = "worker-outbox-events"

export type OutboxEventStatus = "PENDING" | "SUCCESS" | "ERROR"

export type TerminalOutboxEventStatus = Extract<OutboxEventStatus, "SUCCESS" | "ERROR">

/**
 * Outbox row joined with the `events` catalog.
 * `event_name` / `broker_name` come from `events`; routing uses both.
 */
export interface OutboxEventRow {
  id: string
  event_id: string
  event_name: string
  broker_name: string
  payload: Record<string, unknown>
  status: OutboxEventStatus
  created_at: Date
  created_by: string | null
  updated_at: Date
  updated_by: string | null
}

export interface OutboxEventsRepository {
  findById(id: string): Promise<OutboxEventRow | null>
  updateStatus(id: string, status: TerminalOutboxEventStatus): Promise<void>
}

export class SqlOutboxEventsRepository implements OutboxEventsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findById(id: string): Promise<OutboxEventRow | null> {
    const rows = await this.db<OutboxEventRow[]>`
      SELECT
        oe.id,
        oe.event_id,
        e.event_name,
        e.broker_name,
        oe.payload,
        oe.status,
        oe.created_at,
        oe.created_by,
        oe.updated_at,
        oe.updated_by
      FROM outbox_events oe
      INNER JOIN events e ON e.id = oe.event_id
      WHERE oe.id = ${id}
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async updateStatus(id: string, status: TerminalOutboxEventStatus): Promise<void> {
    await this.db`
      UPDATE outbox_events
      SET status = ${status}, updated_at = NOW(), updated_by = ${UPDATED_BY}
      WHERE id = ${id}
    `
  }
}
