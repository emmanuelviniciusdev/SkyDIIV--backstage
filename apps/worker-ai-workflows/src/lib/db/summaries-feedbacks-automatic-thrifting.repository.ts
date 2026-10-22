import { randomUUID } from "crypto"
import type postgres from "postgres"
import { createListedRowOpener, sealListedFields } from "../field-encryption/open-seal"

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
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
  created_by: string | null
  updated_by: string | null
}

export class SqlSummariesFeedbacksAutomaticThriftingRepository
  implements SummariesFeedbacksAutomaticThriftingRepository
{
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<SummaryFeedbackAutomaticThriftingRow | null> {
    const rows = await this.db<SummaryRow[]>`
      SELECT id, user_id, summary, outdated, updated_at, dek, kek_version, encrypted_columns, created_by, updated_by
      FROM summaries_feedbacks_automatic_thrifting
      WHERE user_id = ${userId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const opened = await this.openSummary(row)
    return {
      id: row.id,
      userId: row.user_id,
      summary: opened.summary ?? "",
      outdated: row.outdated,
      updatedAt: row.updated_at,
    }
  }

  async upsertSummary(input: {
    userId: string
    summary: string
    readAt: Date
  }): Promise<void> {
    const existing = await this.db<SummaryRow[]>`
      SELECT id, user_id, summary, outdated, updated_at, dek, kek_version, encrypted_columns, created_by, updated_by
      FROM summaries_feedbacks_automatic_thrifting
      WHERE user_id = ${input.userId}
      LIMIT 1
    `
    const now = new Date()
    const current = existing[0]
    if (!current) {
      const id = randomUUID()
      const sealed = await sealListedFields({
        model: "SummaryFeedbackAutomaticThrifting",
        rowId: id,
        values: { summary: input.summary, createdBy: CREATED_BY, updatedBy: CREATED_BY },
      })
      await this.db`
        INSERT INTO summaries_feedbacks_automatic_thrifting (
          id, user_id, summary, dek, kek_version, encrypted_columns, outdated,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${id},
          ${input.userId},
          ${sealed.values.summary},
          ${sealed.dek},
          ${sealed.kekVersion},
          ${sealed.encryptedColumns},
          ${false},
          ${sealed.values.createdBy},
          ${sealed.values.updatedBy},
          ${now},
          ${now}
        )
      `
      return
    }

    const opened = await this.openSummary(current)
    const sealed = await sealListedFields({
      model: "SummaryFeedbackAutomaticThrifting",
      rowId: current.id,
      values: {
        summary: input.summary,
        createdBy: opened.createdBy ?? CREATED_BY,
        updatedBy: CREATED_BY,
      },
    })
    await this.db`
      UPDATE summaries_feedbacks_automatic_thrifting
      SET summary = ${sealed.values.summary},
          dek = ${sealed.dek},
          kek_version = ${sealed.kekVersion},
          encrypted_columns = ${sealed.encryptedColumns},
          outdated = CASE
            WHEN summaries_feedbacks_automatic_thrifting.updated_at <= ${input.readAt}
             AND summaries_feedbacks_automatic_thrifting.outdated = true
            THEN false
            ELSE summaries_feedbacks_automatic_thrifting.outdated
          END,
          created_by = ${sealed.values.createdBy},
          updated_by = ${sealed.values.updatedBy},
          updated_at = ${now}
      WHERE id = ${current.id}
    `
  }

  async clearStaleEmpty(input: { userId: string; readAt: Date }): Promise<void> {
    const rows = await this.db<SummaryRow[]>`
      SELECT id, user_id, summary, outdated, updated_at, dek, kek_version, encrypted_columns, created_by, updated_by
      FROM summaries_feedbacks_automatic_thrifting
      WHERE user_id = ${input.userId}
        AND outdated = true
        AND updated_at <= ${input.readAt}
      LIMIT 1
    `
    const current = rows[0]
    if (!current) return

    const opened = await this.openSummary(current)
    const sealed = await sealListedFields({
      model: "SummaryFeedbackAutomaticThrifting",
      rowId: current.id,
      values: {
        summary: "",
        createdBy: opened.createdBy ?? CREATED_BY,
        updatedBy: CREATED_BY,
      },
    })
    const now = new Date()
    await this.db`
      UPDATE summaries_feedbacks_automatic_thrifting
      SET summary = ${sealed.values.summary},
          dek = ${sealed.dek},
          kek_version = ${sealed.kekVersion},
          encrypted_columns = ${sealed.encryptedColumns},
          outdated = false,
          created_by = ${sealed.values.createdBy},
          updated_by = ${sealed.values.updatedBy},
          updated_at = ${now}
      WHERE id = ${current.id}
        AND outdated = true
        AND updated_at <= ${input.readAt}
    `
  }

  private async openSummary(row: SummaryRow): Promise<Record<string, string | null>> {
    const open = createListedRowOpener()
    return open({
      model: "SummaryFeedbackAutomaticThrifting",
      rowId: row.id,
      values: { summary: row.summary, createdBy: row.created_by, updatedBy: row.updated_by },
      dek: row.dek,
      kekVersion: row.kek_version,
      encryptedColumns: row.encrypted_columns,
    })
  }
}
