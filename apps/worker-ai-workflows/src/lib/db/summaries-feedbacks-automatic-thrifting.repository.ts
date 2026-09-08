import { randomUUID } from "crypto"
import type postgres from "postgres"

const CREATED_BY = "worker-ai-workflows"

export interface SummaryFeedbackAutomaticThriftingRow {
  id: string
  userId: string
  summary: string
  outdated: boolean
  updatedAt: Date
}

export interface SummariesFeedbacksAutomaticThriftingRepository {
  findByUserId(userId: string): Promise<SummaryFeedbackAutomaticThriftingRow | null>
  upsertSummary(input: {
    userId: string
    summary: string
    readAt: Date
  }): Promise<void>
  clearStaleEmpty(input: { userId: string; readAt: Date }): Promise<void>
}

interface SummaryRow {
  id: string
  user_id: string
  summary: string
  outdated: boolean
  updated_at: Date
}

export class SqlSummariesFeedbacksAutomaticThriftingRepository
  implements SummariesFeedbacksAutomaticThriftingRepository
{
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<SummaryFeedbackAutomaticThriftingRow | null> {
    const rows = await this.db<SummaryRow[]>`
      SELECT id, user_id, summary, outdated, updated_at
      FROM summaries_feedbacks_automatic_thrifting
      WHERE user_id = ${userId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      userId: row.user_id,
      summary: row.summary,
      outdated: row.outdated,
      updatedAt: row.updated_at,
    }
  }

  async upsertSummary(input: {
    userId: string
    summary: string
    readAt: Date
  }): Promise<void> {
    const now = new Date()
    await this.db`
      INSERT INTO summaries_feedbacks_automatic_thrifting (
        id, user_id, summary, outdated, created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${randomUUID()},
        ${input.userId},
        ${input.summary},
        ${false},
        ${CREATED_BY},
        ${CREATED_BY},
        ${now},
        ${now}
      )
      ON CONFLICT (user_id) DO UPDATE
      SET summary = EXCLUDED.summary,
          outdated = CASE
            WHEN summaries_feedbacks_automatic_thrifting.updated_at <= ${input.readAt}
             AND summaries_feedbacks_automatic_thrifting.outdated = true
            THEN false
            ELSE summaries_feedbacks_automatic_thrifting.outdated
          END,
          updated_by = EXCLUDED.updated_by,
          updated_at = ${now}
    `
  }

  async clearStaleEmpty(input: { userId: string; readAt: Date }): Promise<void> {
    const now = new Date()
    await this.db`
      UPDATE summaries_feedbacks_automatic_thrifting
      SET summary = '',
          outdated = false,
          updated_by = ${CREATED_BY},
          updated_at = ${now}
      WHERE user_id = ${input.userId}
        AND outdated = true
        AND updated_at <= ${input.readAt}
    `
  }
}
