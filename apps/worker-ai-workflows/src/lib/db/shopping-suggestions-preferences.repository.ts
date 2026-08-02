import type postgres from "postgres"

export interface ShoppingSuggestionsPreferences {
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
}

export interface ShoppingSuggestionsPreferencesRepository {
  findByUserId(userId: string): Promise<ShoppingSuggestionsPreferences | null>
}

interface ShoppingSuggestionsPreferencesRow {
  gender: string | null
  top_size: string | null
  bottom_size: string | null
  foot_size: string | null
}

export class SqlShoppingSuggestionsPreferencesRepository
  implements ShoppingSuggestionsPreferencesRepository
{
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<ShoppingSuggestionsPreferences | null> {
    const rows = await this.db<ShoppingSuggestionsPreferencesRow[]>`
      SELECT gender, top_size, bottom_size, foot_size
      FROM shopping_suggestions_preferences
      WHERE user_id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      gender: row.gender,
      topSize: row.top_size,
      bottomSize: row.bottom_size,
      footSize: row.foot_size,
    }
  }
}
