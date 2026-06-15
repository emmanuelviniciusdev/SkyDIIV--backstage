import { getWriteDb } from "../../../lib/db/client"
import { SqlWardrobePanoramaRepository } from "../../../lib/db/wardrobe-panorama.repository"
import { createLogger } from "../../../lib/logger"

export interface SavePanoramaInput {
  userId: string
  llmInteractionId?: string
  content: string
}

export async function savePanoramaStep(input: SavePanoramaInput): Promise<void> {
  const log = createLogger("save-panorama", input.userId)
  log.info("Step started")

  const repo = new SqlWardrobePanoramaRepository(getWriteDb())
  try {
    await repo.saveOrUpdate({
      userId: input.userId,
      llmInteractionId: input.llmInteractionId ?? null,
      content: input.content,
    })
    log.info("Panorama persisted")
  } catch (err) {
    log.error("Failed to persist panorama", { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
