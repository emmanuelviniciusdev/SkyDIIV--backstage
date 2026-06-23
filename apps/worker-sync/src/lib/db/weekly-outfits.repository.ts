import type postgres from "postgres"

export interface TranslatableWeeklyOutfit {
  id: string
  weather_summary: string | null
  description_temperature: string | null
}

export interface WeeklyOutfitTranslationUpdate {
  id: string
  weather_summary: string | null
  description_temperature: string | null
}

const CREATED_BY = "worker-sync"

export class SqlWeeklyOutfitsSyncRepository {
  constructor(
    private readonly readDb: postgres.Sql,
    private readonly writeDb: postgres.Sql,
  ) {}

  /**
   * Returns weekly_outfits rows for a user that contain at least one
   * translatable text field (weather_summary or description_temperature).
   */
  async findTranslatableByUserId(userId: string): Promise<TranslatableWeeklyOutfit[]> {
    return this.readDb<TranslatableWeeklyOutfit[]>`
      SELECT
        wo.id,
        wo.weather_summary,
        wo.description_temperature
      FROM weekly_outfits wo
      INNER JOIN weekly_outfit_preferences wop
        ON wo.weekly_outfit_preferences_id = wop.id
      WHERE wop.user_id = ${userId}
        AND (
          wo.weather_summary IS NOT NULL
          OR wo.description_temperature IS NOT NULL
        )
      ORDER BY wo.week_start_date DESC, wo.day_of_week ASC
    `
  }

  async updateTranslations(updates: WeeklyOutfitTranslationUpdate[]): Promise<number> {
    if (updates.length === 0) return 0

    const now = new Date()
    let updatedCount = 0

    for (const update of updates) {
      await this.writeDb`
        UPDATE weekly_outfits
        SET
          weather_summary = ${update.weather_summary},
          description_temperature = ${update.description_temperature},
          updated_at = ${now},
          updated_by = ${CREATED_BY}
        WHERE id = ${update.id}
      `
      updatedCount++
    }

    return updatedCount
  }
}
