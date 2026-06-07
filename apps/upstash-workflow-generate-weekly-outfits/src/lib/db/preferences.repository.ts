import type postgres from "postgres"

export interface UserPreferences {
  id: string
  userId: string
  location: string
  routineDescription: string
}

export interface PreferencesRepository {
  findByUserId(userId: string): Promise<UserPreferences | null>
}

interface PreferencesRow {
  id: string
  user_id: string
  location: string
  routine_description: string
}

export class SqlPreferencesRepository implements PreferencesRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<UserPreferences | null> {
    const rows = await this.db<PreferencesRow[]>`
      SELECT id, user_id, location, routine_description
      FROM weekly_outfit_preferences
      WHERE user_id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      userId: row.user_id,
      location: row.location,
      routineDescription: row.routine_description,
    }
  }
}
