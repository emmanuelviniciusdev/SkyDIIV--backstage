import type postgres from "postgres"

/**
 * A user eligible for weekly outfit generation.
 * Eligibility is the dek / encrypted_columns filter in findUsersWithOutfitPreferences.
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
 * Queries users eligible for weekly outfit generation.
 * Legacy rows (`dek` is null) still need a non-empty location and routine.
 * Sealed rows qualify when `encrypted_columns` contains both fields.
 * Unset location or routine is stored as NULL and omitted from that array.
 * This query does not decrypt preference rows.
 */
export class SqlUsersRepository implements UsersRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findUsersWithOutfitPreferences(): Promise<EligibleUser[]> {
    const rows = await this.db<PreferencesRow[]>`
      SELECT user_id
      FROM weekly_outfit_preferences
      WHERE
        location IS NOT NULL
        AND routine_description IS NOT NULL
        AND (
          (
            dek IS NULL
            AND location <> ''
            AND routine_description <> ''
          )
          OR (
            dek IS NOT NULL
            AND encrypted_columns @> ARRAY['location', 'routine_description']::text[]
          )
        )
    `

    return rows.map((row) => ({ userId: row.user_id }))
  }

  /**
   * Finds users that have at least `minCount` clothing items in their wardrobe.
   * Returns an array of EligibleUser objects ({ userId }).
   */
  async findUsersWithWardrobeSizeAtLeast(minCount: number): Promise<EligibleUser[]> {
    const rows = await this.db<{ user_id: string; cnt: number }[]>`
      SELECT ci.user_id, COUNT(*) AS cnt
      FROM clothing_items ci
      GROUP BY ci.user_id
      HAVING COUNT(*) >= ${minCount}
    `

    return rows.map((r) => ({ userId: r.user_id }))
  }
}
