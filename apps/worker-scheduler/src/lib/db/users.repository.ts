import type postgres from "postgres"

/**
 * A user eligible for weekly outfit generation.
 * A row existing in weekly_outfit_preferences means generation is enabled.
 */
export interface EligibleUser {
  userId: string
}

export interface UsersRepository {
  findUsersWithOutfitPreferences(): Promise<EligibleUser[]>
}

interface PreferencesRow {
  user_id: string
}

/**
 * Queries all users that have outfit preferences defined.
 * "Defined" means a row exists in weekly_outfit_preferences — the presence
 * of the row (with required non-null location + routine_description) is the
 * opt-in signal per the Prisma schema comment in the web app.
 */
export class SqlUsersRepository implements UsersRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findUsersWithOutfitPreferences(): Promise<EligibleUser[]> {
    const rows = await this.db<PreferencesRow[]>`
      SELECT user_id
      FROM weekly_outfit_preferences
      WHERE location    IS NOT NULL
        AND location    <> ''
        AND routine_description IS NOT NULL
        AND routine_description <> ''
    `

    return rows.map((row) => ({ userId: row.user_id }))
  }
}
