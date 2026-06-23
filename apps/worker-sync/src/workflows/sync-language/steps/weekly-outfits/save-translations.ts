import { z } from "zod"
import { getReadDb, getWriteDb } from "../../../../lib/db/client"
import {
  SqlWeeklyOutfitsSyncRepository,
  type TranslatableWeeklyOutfit,
  type WeeklyOutfitTranslationUpdate,
} from "../../../../lib/db/weekly-outfits.repository"
import { createLogger } from "../../../../lib/logger"
import { parseJsonResponse } from "../../../../lib/prompt/parse"

export interface SaveWeeklyOutfitsTranslationsInput {
  userId: string
  sourceRecords: TranslatableWeeklyOutfit[]
  rawResponse: string
}

export interface SaveWeeklyOutfitsTranslationsResult {
  translatedCount: number
}

const WeeklyOutfitTranslationSchema = z.array(
  z.object({
    id: z.string().uuid(),
    weather_summary: z.string().nullable(),
    description_temperature: z.string().nullable(),
  }),
)

export async function saveWeeklyOutfitsTranslationsStep(
  input: SaveWeeklyOutfitsTranslationsInput,
): Promise<SaveWeeklyOutfitsTranslationsResult> {
  const log = createLogger("weekly-outfits-save-translations", input.userId)
  log.info("Step started", { recordCount: input.sourceRecords.length })

  const parsed = parseJsonResponse(
    input.rawResponse,
    WeeklyOutfitTranslationSchema,
    "weekly_outfits translation",
  )
  const translations = mergeWeeklyOutfitTranslations(input.sourceRecords, parsed)

  const repo = new SqlWeeklyOutfitsSyncRepository(getReadDb(), getWriteDb())
  const translatedCount = await repo.updateTranslations(translations)

  log.info("Step completed", { translatedCount })
  return { translatedCount }
}

export function mergeWeeklyOutfitTranslations(
  sourceRecords: TranslatableWeeklyOutfit[],
  llmRecords: z.infer<typeof WeeklyOutfitTranslationSchema>,
): WeeklyOutfitTranslationUpdate[] {
  const sourceById = new Map(sourceRecords.map((record) => [record.id, record]))
  const updates: WeeklyOutfitTranslationUpdate[] = []

  for (const translation of llmRecords) {
    const source = sourceById.get(translation.id)
    if (!source) {
      throw new Error(`LLM returned unknown weekly_outfits id: ${translation.id}`)
    }

    updates.push({
      id: translation.id,
      weather_summary: source.weather_summary === null ? null : translation.weather_summary,
      description_temperature:
        source.description_temperature === null ? null : translation.description_temperature,
    })
  }

  if (updates.length !== sourceRecords.length) {
    throw new Error(
      `LLM returned ${updates.length} weekly_outfits translations, expected ${sourceRecords.length}`,
    )
  }

  return updates
}
