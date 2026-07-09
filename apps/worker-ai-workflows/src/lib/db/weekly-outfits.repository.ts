import { randomUUID } from "crypto"
import type postgres from "postgres"
import { createLogger } from "../logger"
import type { DayWeatherInfo } from "../i18n/weather/formatters"

export interface OutfitSuggestion {
  weekday: string
  clothingPieceIds: string[]
}

export interface SaveWeeklyOutfitsInput {
  userId: string
  weeklyOutfitPreferencesId: string
  /** Sunday of the target week in ISO format: "YYYY-MM-DD". */
  weekStartDate: string
  suggestions: OutfitSuggestion[]
  /** Maps English weekday name (e.g. "sunday") → weather data stored in weekly_outfits. */
  dayWeatherByWeekday: Record<string, DayWeatherInfo>
}

/** A reference to an outfit that was successfully saved to the database. */
export interface SavedOutfitRef {
  outfitId: string
  weekday: string
  clothingPieceIds: string[]
}

export interface WeeklyOutfitsRepository {
  saveWeeklyOutfits(input: SaveWeeklyOutfitsInput): Promise<SavedOutfitRef[]>
}

const WEEKDAY_TO_DAY_OF_WEEK: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const CREATED_BY = "worker-ai-workflows"

export class SqlWeeklyOutfitsRepository implements WeeklyOutfitsRepository {
  constructor(
    private readonly readDb: postgres.Sql,
    private readonly writeDb: postgres.Sql,
  ) {}

  /**
   * Replaces the weekly outfits for a given user/week with the newly generated
   * suggestions. All deletes and inserts run inside a single postgres.js
   * transaction (sql.begin), making the operation atomic and idempotent.
   *
   * Returns refs for every outfit that was successfully inserted.
   * `outfits.image_url` is left NULL — thumbnail generation is not performed.
   */
  async saveWeeklyOutfits(input: SaveWeeklyOutfitsInput): Promise<SavedOutfitRef[]> {
    const { userId, weeklyOutfitPreferencesId, weekStartDate, suggestions, dayWeatherByWeekday } = input
    const log = createLogger("weekly-outfits-repo", userId)

    const existing = await this.readDb<{ outfit_id: string }[]>`
      SELECT outfit_id
      FROM weekly_outfits
      WHERE weekly_outfit_preferences_id = ${weeklyOutfitPreferencesId}
        AND week_start_date = ${weekStartDate}::date
    `
    const existingOutfitIds = existing.map((r) => r.outfit_id)
    log.info("Existing outfits found", { count: existingOutfitIds.length, weekStartDate })

    const savedRefs = await this.writeDb.begin(async (tx) => {
      log.debug("Transaction started")

      if (existingOutfitIds.length > 0) {
        await tx`
          DELETE FROM outfits
          WHERE id = ANY(${existingOutfitIds})
        `
        log.info("Deleted existing outfits", { count: existingOutfitIds.length })
      }


      const now = new Date()
      const refs: SavedOutfitRef[] = []

      for (const suggestion of suggestions) {
        const dayOfWeek = WEEKDAY_TO_DAY_OF_WEEK[suggestion.weekday.toLowerCase()]

        if (dayOfWeek === undefined) {
          log.warn("Unknown weekday — skipping", { weekday: suggestion.weekday })
          continue
        }
        if (suggestion.clothingPieceIds.length === 0) {
          log.warn("No clothing pieces for weekday — skipping", { weekday: suggestion.weekday })
          continue
        }

        const outfitId = randomUUID()
        const title = `Weekly AI Outfit — ${capitalise(suggestion.weekday)}`
        const dayWeather = dayWeatherByWeekday[suggestion.weekday.toLowerCase()] ?? null
        const weatherSummary = dayWeather?.weatherSummary ?? null

        log.debug("Inserting outfit", {
          weekday: suggestion.weekday,
          clothingPieceCount: suggestion.clothingPieceIds.length,
          hasWeatherSummary: weatherSummary !== null,
        })

        await tx`
          INSERT INTO outfits (
            id, user_id, type, title,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${outfitId}, ${userId}, 'AI_GENERATED', ${title},
            ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
          )
        `

        for (const clothingItemId of suggestion.clothingPieceIds) {
          await tx`
            INSERT INTO outfit_items (
              id, outfit_id, clothing_item_id,
              created_by, updated_by, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${outfitId}, ${clothingItemId},
              ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
            )
          `
        }

        await tx`
          INSERT INTO weekly_outfits (
            id, weekly_outfit_preferences_id, outfit_id,
            week_start_date, day_of_week, weather_summary, weather_code,
            min_temperature, max_temperature, unity_temperature, description_temperature,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${randomUUID()}, ${weeklyOutfitPreferencesId}, ${outfitId},
            ${weekStartDate}::date, ${dayOfWeek}, ${weatherSummary}, ${dayWeather?.weatherCode ?? null},
            ${dayWeather?.minTemperature ?? null}, ${dayWeather?.maxTemperature ?? null},
            ${dayWeather?.unityTemperature ?? null}, ${dayWeather?.descriptionTemperature ?? null},
            ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
          )
        `

        refs.push({ outfitId, weekday: suggestion.weekday, clothingPieceIds: suggestion.clothingPieceIds })
      }

      log.info("Transaction completed", { insertedCount: refs.length })
      return refs
    })

    return savedRefs ?? []
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
