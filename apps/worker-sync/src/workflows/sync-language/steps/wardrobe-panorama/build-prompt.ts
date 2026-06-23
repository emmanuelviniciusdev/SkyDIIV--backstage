import { buildSyncWardrobePanoramaPrompt } from "../../../../lib/i18n/prompts/sync-wardrobe-panorama"
import { createLogger } from "../../../../lib/logger"
import type { TranslatableWardrobePanorama } from "../../../../lib/db/wardrobe-panorama.repository"

export interface BuildWardrobePanoramaPromptInput {
  userId: string
  oldLanguage: string
  newLanguage: string
  record: TranslatableWardrobePanorama
}

export interface BuildWardrobePanoramaPromptResult {
  userId: string
  record: TranslatableWardrobePanorama
  prompt: string
}

export function buildWardrobePanoramaPromptStep(
  input: BuildWardrobePanoramaPromptInput,
): BuildWardrobePanoramaPromptResult {
  const log = createLogger("wardrobe-panorama-build-prompt", input.userId)
  log.info("Step started", { panoramaId: input.record.id })

  const prompt = buildSyncWardrobePanoramaPrompt({
    oldLanguage: input.oldLanguage,
    newLanguage: input.newLanguage,
    record: input.record,
  })

  log.info("Step completed", { promptLength: prompt.length })

  return {
    userId: input.userId,
    record: input.record,
    prompt,
  }
}
