import type postgres from "postgres"
import { createListedRowOpener } from "../field-encryption/open-seal"

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
  id: string
  gender: string | null
  top_size: string | null
  bottom_size: string | null
  foot_size: string | null
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
}

export class SqlShoppingSuggestionsPreferencesRepository
  implements ShoppingSuggestionsPreferencesRepository
{
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<ShoppingSuggestionsPreferences | null> {
    const rows = await this.db<ShoppingSuggestionsPreferencesRow[]>`
      SELECT id, gender, top_size, bottom_size, foot_size, dek, kek_version, encrypted_columns
      FROM shopping_suggestions_preferences
      WHERE user_id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    const open = createListedRowOpener()
    const opened = await open({
      model: "ShoppingSuggestionsPreferences",
      rowId: row.id,
      values: {
        gender: row.gender,
        topSize: row.top_size,
        bottomSize: row.bottom_size,
        footSize: row.foot_size,
      },
      dek: row.dek,
      kekVersion: row.kek_version,
      encryptedColumns: row.encrypted_columns,
    })
    return {
      gender: opened.gender ?? null,
      topSize: opened.topSize ?? null,
      bottomSize: opened.bottomSize ?? null,
      footSize: opened.footSize ?? null,
    }
  }
}
