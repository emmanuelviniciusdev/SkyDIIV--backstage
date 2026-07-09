import { getReadDb, getWriteDb } from "../../../lib/db/client"
import { SqlWeeklyOutfitsRepository } from "../../../lib/db/weekly-outfits.repository"
import { createLogger } from "../../../lib/logger"
import type { ParsedOutfitSuggestion } from "../../../lib/prompt/builder"
import type { DayWeatherInfo } from "../../../lib/i18n/weather/formatters"
import type { SavedOutfitRef } from "../../../lib/db/weekly-outfits.repository"

export type { SavedOutfitRef }

export interface SaveOutfitsInput {
  userId: string
  weeklyOutfitPreferencesId: string
  weekStartDate: string
  suggestions: ParsedOutfitSuggestion[]
  dayWeatherByWeekday: Record<string, DayWeatherInfo>
  /**
   * IDs of every clothing item that actually belongs to this user's wardrobe
   * (sourced from step 1). Any ID the LLM returns that is not in this set is
   * dropped here with a warning so it never reaches the DB and triggers a
   * foreign-key constraint violation.
   */
  validClothingItemIds: string[]
}

/**
 * Step 3 — Persists the LLM-generated outfit suggestions to the database.
 *
 * This step is idempotent: any existing weekly outfits for the same user/week
 * are deleted (inside the same transaction) before the new records are created.
 *
 * Returns refs for the saved outfits (outfitId, weekday, clothingPieceIds).
 */
export async function saveOutfitsStep(input: SaveOutfitsInput): Promise<SavedOutfitRef[]> {
  const log = createLogger("save-outfits", input.userId)
  log.info("Step started", {
    weekStartDate: input.weekStartDate,
    suggestionCount: input.suggestions.length,
    weeklyOutfitPreferencesId: input.weeklyOutfitPreferencesId,
  })

  // Filter out any clothing item IDs the LLM hallucinated so they never reach
  // the DB and trigger a foreign-key constraint violation.
  const validIds = new Set(input.validClothingItemIds)
  const sanitisedSuggestions = input.suggestions.map((s) => {
    const validPieceIds = s.clothingPieceIds.filter((id) => validIds.has(id))
    const hallucinated = s.clothingPieceIds.filter((id) => !validIds.has(id))
    if (hallucinated.length > 0) {
      log.warn("LLM hallucinated clothing item IDs — dropping them", {
        weekday: s.weekday,
        hallucinated,
        kept: validPieceIds.length,
      })
    }
    return { ...s, clothingPieceIds: validPieceIds }
  })

  const repo = new SqlWeeklyOutfitsRepository(getReadDb(), getWriteDb())

  const savedOutfits = await repo.saveWeeklyOutfits({
    userId: input.userId,
    weeklyOutfitPreferencesId: input.weeklyOutfitPreferencesId,
    weekStartDate: input.weekStartDate,
    suggestions: sanitisedSuggestions,
    dayWeatherByWeekday: input.dayWeatherByWeekday,
  })

  log.info("Step completed — outfits saved", {
    weekStartDate: input.weekStartDate,
    savedCount: savedOutfits.length,
  })

  return savedOutfits
}
