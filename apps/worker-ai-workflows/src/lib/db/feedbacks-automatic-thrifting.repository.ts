import type postgres from "postgres"
import { createListedRowOpener } from "../field-encryption/open-seal"

export interface FeedbackAutomaticThriftingRow {
  id: string
  userId: string
  scrapedProductId: string
  liked: boolean
  reason: string | null
  jsonSearch: unknown
  jsonResult: unknown
  jsonListedProduct: unknown
  createdAt: Date
}

export interface FeedbacksAutomaticThriftingRepository {
  countByUserId(userId: string): Promise<number>
  findMostRecentByUserId(userId: string, maxEntries: number): Promise<FeedbackAutomaticThriftingRow[]>
}

interface FeedbackRow {
  id: string
  user_id: string
  scraped_product_id: string
  liked: boolean
  reason: string | null
  json_search: unknown
  json_result: unknown
  json_listed_product: unknown
  created_at: Date
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
}

function mapRow(
  row: FeedbackRow,
  reason: string | null,
): FeedbackAutomaticThriftingRow {
  return {
    id: row.id,
    userId: row.user_id,
    scrapedProductId: row.scraped_product_id,
    liked: row.liked,
    reason,
    jsonSearch: row.json_search,
    jsonResult: row.json_result,
    jsonListedProduct: row.json_listed_product,
    createdAt: row.created_at,
  }
}

export class SqlFeedbacksAutomaticThriftingRepository
  implements FeedbacksAutomaticThriftingRepository
{
  constructor(private readonly db: postgres.Sql) {}

  async countByUserId(userId: string): Promise<number> {
    const rows = await this.db<{ count: string | number }[]>`
      SELECT COUNT(*)::int AS count
      FROM feedbacks_automatic_thrifting
      WHERE user_id = ${userId}
    `
    return Number(rows[0]?.count ?? 0)
  }

  async findMostRecentByUserId(
    userId: string,
    maxEntries: number,
  ): Promise<FeedbackAutomaticThriftingRow[]> {
    const rows = await this.db<FeedbackRow[]>`
      SELECT
        id,
        user_id,
        scraped_product_id,
        liked,
        reason,
        json_search,
        json_result,
        json_listed_product,
        created_at,
        dek,
        kek_version,
        encrypted_columns
      FROM feedbacks_automatic_thrifting
      WHERE user_id = ${userId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${maxEntries}
    `
    const open = createListedRowOpener()
    return Promise.all(rows.map(async (row) => {
      const opened = await open({
        model: "FeedbackAutomaticThrifting",
        rowId: row.id,
        values: { reason: row.reason },
        dek: row.dek,
        kekVersion: row.kek_version,
        encryptedColumns: row.encrypted_columns,
      })
      return mapRow(row, opened.reason ?? null)
    }))
  }
}
