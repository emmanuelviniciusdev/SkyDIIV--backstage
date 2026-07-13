import type postgres from "postgres"

export interface UserLanguageDomain {
  name: string
}

export class SqlAppPreferencesRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findLanguageByUserId(userId: string): Promise<UserLanguageDomain | null> {
    const rows = await this.db<{ name: string }[]>`
      SELECT d.name
      FROM app_preferences ap
      INNER JOIN domains d ON d.id = ap.language_id
      WHERE ap.user_id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null
    const [row] = rows
    return { name: row.name }
  }
}
