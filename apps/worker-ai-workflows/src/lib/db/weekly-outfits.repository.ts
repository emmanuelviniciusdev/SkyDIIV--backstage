import { randomUUID } from "crypto"
import type postgres from "postgres"
import { createLogger } from "../logger"
import type { DayWeatherInfo } from "../i18n/weather/formatters"
import {
  buildDefaultBoardLayout,
  type BoardLayoutItem,
} from "../outfits/board-layout"
import { deleteImageFromR2 } from "../storage/r2-client"

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
  /** Creative-board layout written to outfit_items (1600×1600 canvas). */
  layout: BoardLayoutItem[]
}

export interface WeeklyOutfitsRepository {
  saveWeeklyOutfits(input: SaveWeeklyOutfitsInput): Promise<SavedOutfitRef[]>
  updateOutfitImageUrl(outfitId: string, imageUrl: string): Promise<void>
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
   * Each outfit_item is written with creative-board layout columns
   * (pos_x/y, width, height, z_index, rotation) from buildDefaultBoardLayout.
   * `outfits.image_url` is left NULL here — thumbnails are generated in a
   * later workflow step.
   *
   * Returns refs for every outfit that was successfully inserted (including layout).
   */
  async saveWeeklyOutfits(input: SaveWeeklyOutfitsInput): Promise<SavedOutfitRef[]> {
    const { userId, weeklyOutfitPreferencesId, weekStartDate, suggestions, dayWeatherByWeekday } = input
    const log = createLogger("weekly-outfits-repo", userId)

    // Look up on the write (direct) connection so we never miss rows due to
    // read-replica lag on the pooled DATABASE_URL endpoint.
    const existing = await this.writeDb<{ outfit_id: string }[]>`
      SELECT outfit_id
      FROM weekly_outfits
      WHERE weekly_outfit_preferences_id = ${weeklyOutfitPreferencesId}
        AND week_start_date = ${weekStartDate}::date
    `
    const existingOutfitIds = existing.map((r) => r.outfit_id)
    log.info("Existing outfits found", { count: existingOutfitIds.length, weekStartDate })

    // Best-effort R2 cleanup for prior thumbnails (PNG current + JPEG legacy).
    // Done before the DB transaction so orphaned objects are still removed even
    // if a previous run generated no thumbnail (image_url was null).
    if (existingOutfitIds.length > 0) {
      const deletions = existingOutfitIds.flatMap((outfitId) =>
        [`outfits/${outfitId}.png`, `outfits/${outfitId}.jpg`].map(async (key) => {
          try {
            await deleteImageFromR2(key)
            log.debug("Deleted old thumbnail from R2", { key })
          } catch (err) {
            log.warn("Failed to delete old thumbnail from R2 — continuing", {
              key,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }),
      )
      await Promise.all(deletions)
      log.info("R2 thumbnail cleanup complete", { count: existingOutfitIds.length })
    }

    const savedRefs = await this.writeDb.begin(async (tx) => {
      log.debug("Transaction started")

      if (existingOutfitIds.length > 0) {
        // postgres.js requires `IN ${sql(ids)}` for dynamic value lists.
        // `ANY(${jsArray})` binds as a single opaque parameter and does not
        // match UUID rows, so old outfits / outfit_items were left behind.
        await tx`
          DELETE FROM outfits
          WHERE id IN ${tx(existingOutfitIds)}
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
        const layout = buildDefaultBoardLayout(suggestion.clothingPieceIds)

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

        for (const item of layout) {
          await tx`
            INSERT INTO outfit_items (
              id, outfit_id, clothing_item_id,
              pos_x, pos_y, width, height, z_index, rotation,
              created_by, updated_by, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${outfitId}, ${item.clothingItemId},
              ${item.posX}, ${item.posY}, ${item.width}, ${item.height}, ${item.zIndex}, ${item.rotation},
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

        refs.push({
          outfitId,
          weekday: suggestion.weekday,
          clothingPieceIds: suggestion.clothingPieceIds,
          layout,
        })
      }

      log.info("Transaction completed", { insertedCount: refs.length })
      return refs
    })

    return savedRefs ?? []
  }

  async updateOutfitImageUrl(outfitId: string, imageUrl: string): Promise<void> {
    const now = new Date()
    await this.writeDb`
      UPDATE outfits
      SET image_url = ${imageUrl}, updated_at = ${now}, updated_by = ${CREATED_BY}
      WHERE id = ${outfitId}
    `
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
