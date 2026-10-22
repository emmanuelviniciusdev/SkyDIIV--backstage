import type postgres from "postgres"
import { createListedRowOpener } from "../field-encryption/open-seal"

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
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
}

export class SqlPreferencesRepository implements PreferencesRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<UserPreferences | null> {
    const rows = await this.db<PreferencesRow[]>`
      SELECT id, user_id, location, routine_description, dek, kek_version, encrypted_columns
      FROM weekly_outfit_preferences
      WHERE user_id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    const open = createListedRowOpener()
    const opened = await open({
      model: "WeeklyOutfitPreferences",
      rowId: row.id,
      values: {
        location: row.location,
        routineDescription: row.routine_description,
      },
      dek: row.dek,
      kekVersion: row.kek_version,
      encryptedColumns: row.encrypted_columns,
    })
    return {
      id: row.id,
      userId: row.user_id,
      location: opened.location ?? "",
      routineDescription: opened.routineDescription ?? "",
    }
  }
}
