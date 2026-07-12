import type postgres from "postgres"

export const UPDATED_BY = "worker-outbox-events"

export type OutboxEventStatus = "PENDING" | "SUCCESS" | "ERROR"

export type TerminalOutboxEventStatus = Extract<OutboxEventStatus, "SUCCESS" | "ERROR">

export interface OutboxEventRow {
  id: string
  flow: string
  event: string
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
      SELECT id, flow, event, payload, status, created_at, created_by, updated_at, updated_by
      FROM outbox_events
      WHERE id = ${id}
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
