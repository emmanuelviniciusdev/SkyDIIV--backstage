import { z } from "zod"
import { getReadDb, getWriteDb } from "../../../../lib/db/client"
import {
  SqlWardrobePanoramaSyncRepository,
  type TranslatableWardrobePanorama,
} from "../../../../lib/db/wardrobe-panorama.repository"
import { createLogger } from "../../../../lib/logger"
import { parseJsonResponse } from "../../../../lib/prompt/parse"

export interface SaveWardrobePanoramaTranslationInput {
  userId: string
  sourceRecord: TranslatableWardrobePanorama
  rawResponse: string
}

export interface SaveWardrobePanoramaTranslationResult {
  translated: boolean
}

const WardrobePanoramaTranslationSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1),
})

export async function saveWardrobePanoramaTranslationStep(
  input: SaveWardrobePanoramaTranslationInput,
): Promise<SaveWardrobePanoramaTranslationResult> {
  const log = createLogger("wardrobe-panorama-save-translation", input.userId)
  log.info("Step started", { panoramaId: input.sourceRecord.id })

  const translation = parseJsonResponse(
    input.rawResponse,
    WardrobePanoramaTranslationSchema,
    "wardrobe_panorama translation",
  )

  if (translation.id !== input.sourceRecord.id) {
    throw new Error(
      `LLM returned wardrobe_panorama id ${translation.id}, expected ${input.sourceRecord.id}`,
    )
  }

  const repo = new SqlWardrobePanoramaSyncRepository(getReadDb(), getWriteDb())
  await repo.updateContent(translation.id, translation.content)

  log.info("Step completed", { contentLength: translation.content.length })
  return { translated: true }
}
