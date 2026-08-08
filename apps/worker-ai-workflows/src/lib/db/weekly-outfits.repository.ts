import { randomUUID } from "crypto"
import type postgres from "postgres"
import { createLogger } from "../logger"
import type { DayWeatherInfo } from "../i18n/weather/formatters"
import {
  buildOutfitCollageLayout,
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
  /** clothing item ID → piece type name (e.g. "Top") for flat-lay collage layout. */
  pieceTypeById?: Record<string, string | null>
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

interface PreparedOutfit {
  outfitId: string
  weekday: string
  dayOfWeek: number
  clothingPieceIds: string[]
  layout: BoardLayoutItem[]
  title: string
  dayWeather: DayWeatherInfo | null
  weatherSummary: string | null
}

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
   * Old rows are removed without a pre-SELECT: new outfit IDs are allocated
   * first, then this user's `AI_GENERATED` outfits whose IDs are not in that
   * set are deleted (any week — so late runs still replace stale data),
   * RETURNING ids for R2 cleanup, then the new rows are inserted.
   *
   * Each outfit_item is written with creative-board layout columns
   * (pos_x/y, width, height, z_index) from buildOutfitCollageLayout.
   * `rotation` is always persisted as 0 — CF Images does not apply rotation
   * when compositing thumbnails.
   * `outfits.image_url` is left NULL here — thumbnails are generated in a
   * later workflow step.
   *
   * Returns refs for every outfit that was successfully inserted (including layout).
   */
  async saveWeeklyOutfits(input: SaveWeeklyOutfitsInput): Promise<SavedOutfitRef[]> {
    const { userId, weeklyOutfitPreferencesId, weekStartDate, suggestions, dayWeatherByWeekday, pieceTypeById } =
      input
    const log = createLogger("weekly-outfits-repo", userId)
    const typeById = pieceTypeById ?? {}

    const prepared = prepareOutfits(suggestions, dayWeatherByWeekday, typeById, log)
    const newOutfitIds = prepared.map((p) => p.outfitId)

    const { savedRefs, deletedOutfitIds } = await this.writeDb.begin(async (tx) => {
      log.debug("Transaction started")

      // Delete this user's prior AI-generated outfits that are not the ones we
      // are about to insert. Scoped by user_id (not week), so a late / out-of-date
      // run still replaces stale weeks. type = AI_GENERATED keeps user-created
      // outfits intact. Fresh UUIDs mean every previous AI week is removed
      // without a SELECT. postgres.js requires `NOT IN ${sql(ids)}` for dynamic
      // UUID lists — `ANY(${jsArray})` does not match.
      const deletedRows =
        newOutfitIds.length > 0
          ? await tx<{ id: string }[]>`
              DELETE FROM outfits
              WHERE user_id = ${userId}
                AND type = 'AI_GENERATED'
                AND id NOT IN ${tx(newOutfitIds)}
              RETURNING id
            `
          : await tx<{ id: string }[]>`
              DELETE FROM outfits
              WHERE user_id = ${userId}
                AND type = 'AI_GENERATED'
              RETURNING id
            `

      const deletedIds = deletedRows.map((r) => r.id)
      if (deletedIds.length > 0) {
        log.info("Deleted existing outfits", { count: deletedIds.length })
      }

      const now = new Date()
      const refs: SavedOutfitRef[] = []

      for (const outfit of prepared) {
        log.debug("Inserting outfit", {
          weekday: outfit.weekday,
          clothingPieceCount: outfit.clothingPieceIds.length,
          hasWeatherSummary: outfit.weatherSummary !== null,
        })

        await tx`
          INSERT INTO outfits (
            id, user_id, type, title,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${outfit.outfitId}, ${userId}, 'AI_GENERATED', ${outfit.title},
            ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
          )
        `

        for (const item of outfit.layout) {
          await tx`
            INSERT INTO outfit_items (
              id, outfit_id, clothing_item_id,
              pos_x, pos_y, width, height, z_index, rotation,
              created_by, updated_by, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${outfit.outfitId}, ${item.clothingItemId},
              ${item.posX}, ${item.posY}, ${item.width}, ${item.height}, ${item.zIndex}, ${0},
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
            ${randomUUID()}, ${weeklyOutfitPreferencesId}, ${outfit.outfitId},
            ${weekStartDate}::date, ${outfit.dayOfWeek}, ${outfit.weatherSummary}, ${outfit.dayWeather?.weatherCode ?? null},
            ${outfit.dayWeather?.minTemperature ?? null}, ${outfit.dayWeather?.maxTemperature ?? null},
            ${outfit.dayWeather?.unityTemperature ?? null}, ${outfit.dayWeather?.descriptionTemperature ?? null},
            ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
          )
        `

        refs.push({
          outfitId: outfit.outfitId,
          weekday: outfit.weekday,
          clothingPieceIds: outfit.clothingPieceIds,
          layout: outfit.layout,
        })
      }

      log.info("Transaction completed", { insertedCount: refs.length, deletedCount: deletedIds.length })
      return { savedRefs: refs, deletedOutfitIds: deletedIds }
    })

    // Best-effort R2 cleanup after commit — uses IDs returned by DELETE so we
    // never need a pre-SELECT. Orphaned objects from a prior failed run are
    // acceptable; image_url may have been null.
    if (deletedOutfitIds.length > 0) {
      await deletePriorThumbnails(deletedOutfitIds, log)
    }

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

function prepareOutfits(
  suggestions: OutfitSuggestion[],
  dayWeatherByWeekday: Record<string, DayWeatherInfo>,
  typeById: Record<string, string | null>,
  log: ReturnType<typeof createLogger>,
): PreparedOutfit[] {
  const prepared: PreparedOutfit[] = []

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

    const dayWeather = dayWeatherByWeekday[suggestion.weekday.toLowerCase()] ?? null
    prepared.push({
      outfitId: randomUUID(),
      weekday: suggestion.weekday,
      dayOfWeek,
      clothingPieceIds: suggestion.clothingPieceIds,
      layout: buildOutfitCollageLayout(
        suggestion.clothingPieceIds.map((id) => ({
          id,
          pieceType: typeById[id] ?? null,
        })),
      ),
      title: `Weekly AI Outfit — ${capitalise(suggestion.weekday)}`,
      dayWeather,
      weatherSummary: dayWeather?.weatherSummary ?? null,
    })
  }

  return prepared
}

async function deletePriorThumbnails(
  outfitIds: string[],
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  const deletions = outfitIds.flatMap((outfitId) =>
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
  log.info("R2 thumbnail cleanup complete", { count: outfitIds.length })
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
