import type postgres from "postgres"

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
}

function mapRow(row: FeedbackRow): FeedbackAutomaticThriftingRow {
  return {
    id: row.id,
    userId: row.user_id,
    scrapedProductId: row.scraped_product_id,
    liked: row.liked,
    reason: row.reason,
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
        created_at
      FROM feedbacks_automatic_thrifting
      WHERE user_id = ${userId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${maxEntries}
    `
    return rows.map(mapRow)
  }
}
