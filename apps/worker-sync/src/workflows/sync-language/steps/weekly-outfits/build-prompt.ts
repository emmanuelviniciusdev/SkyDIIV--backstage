import { buildSyncWeeklyOutfitsPrompt } from "../../../../lib/i18n/prompts/sync-weekly-outfits"
import { createLogger } from "../../../../lib/logger"
import type { TranslatableWeeklyOutfit } from "../../../../lib/db/weekly-outfits.repository"

export interface BuildWeeklyOutfitsPromptInput {
  userId: string
  oldLanguage: string
  newLanguage: string
  records: TranslatableWeeklyOutfit[]
}

export interface BuildWeeklyOutfitsPromptResult {
  userId: string
  oldLanguage: string
  newLanguage: string
  records: TranslatableWeeklyOutfit[]
  prompt: string
}

export function buildWeeklyOutfitsPromptStep(
  input: BuildWeeklyOutfitsPromptInput,
): BuildWeeklyOutfitsPromptResult {
  const log = createLogger("weekly-outfits-build-prompt", input.userId)
  log.info("Step started", { recordCount: input.records.length })

  const prompt = buildSyncWeeklyOutfitsPrompt({
    oldLanguage: input.oldLanguage,
    newLanguage: input.newLanguage,
    records: input.records,
  })

  log.info("Step completed", { promptLength: prompt.length })

  return {
    userId: input.userId,
    oldLanguage: input.oldLanguage,
    newLanguage: input.newLanguage,
    records: input.records,
    prompt,
  }
}
