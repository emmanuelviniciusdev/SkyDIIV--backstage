import type postgres from "postgres"

export interface UserLanguageDomain {
  name: string
}

export interface AppPreferencesRepository {
  findLanguageByUserId(userId: string): Promise<UserLanguageDomain | null>
}

interface LanguageRow {
  name: string
}

export class SqlAppPreferencesRepository implements AppPreferencesRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findLanguageByUserId(userId: string): Promise<UserLanguageDomain | null> {
    const rows = await this.db<LanguageRow[]>`
      SELECT d.name
      FROM app_preferences ap
      INNER JOIN domains d ON d.id = ap.language_id
      WHERE ap.user_id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return { name: row.name }
  }
}
