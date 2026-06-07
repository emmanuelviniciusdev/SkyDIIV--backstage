import { getReadDb, getWriteDb } from "../lib/db/client"
import { SqlWeeklyOutfitsRepository } from "../lib/db/weekly-outfits.repository"
import { createLogger } from "../lib/logger"
import type { ParsedOutfitSuggestion } from "../lib/prompt/builder"
import type { SavedOutfitRef } from "../lib/db/weekly-outfits.repository"

export type { SavedOutfitRef }

export interface SaveOutfitsInput {
  userId: string
  weeklyOutfitPreferencesId: string
  weekStartDate: string
  suggestions: ParsedOutfitSuggestion[]
  dayWeatherSummaries: Record<string, string>
}

/**
 * Step 3 — Persists the LLM-generated outfit suggestions to the database.
 *
 * This step is idempotent: any existing weekly outfits for the same user/week
 * are deleted (inside the same transaction) before the new records are created.
 *
 * Returns refs for the saved outfits so that step 4 (generate-images) can
 * composite and attach images without an extra DB round-trip.
 */
export async function saveOutfitsStep(input: SaveOutfitsInput): Promise<SavedOutfitRef[]> {
  const log = createLogger("save-outfits", input.userId)
  log.info("Step started", {
    weekStartDate: input.weekStartDate,
    suggestionCount: input.suggestions.length,
    weeklyOutfitPreferencesId: input.weeklyOutfitPreferencesId,
  })

  const repo = new SqlWeeklyOutfitsRepository(getReadDb(), getWriteDb())

  const savedOutfits = await repo.saveWeeklyOutfits({
    userId: input.userId,
    weeklyOutfitPreferencesId: input.weeklyOutfitPreferencesId,
    weekStartDate: input.weekStartDate,
    suggestions: input.suggestions,
    dayWeatherSummaries: input.dayWeatherSummaries,
  })

  log.info("Step completed — outfits saved", {
    weekStartDate: input.weekStartDate,
    savedCount: savedOutfits.length,
  })

  return savedOutfits
}
