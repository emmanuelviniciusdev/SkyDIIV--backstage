import { getReadDb } from "../../../lib/db/client"
import { SqlWeeklyOutfitsSyncRepository } from "../../../lib/db/weekly-outfits.repository"
import { SqlWardrobePanoramaSyncRepository } from "../../../lib/db/wardrobe-panorama.repository"
import { createLogger } from "../../../lib/logger"
import type { TranslatableRecords } from "../types"

export async function loadTranslatableRecordsStep(userId: string): Promise<TranslatableRecords> {
  const log = createLogger("load-translatable-records", userId)
  log.info("Step started")

  const readDb = getReadDb()
  const weeklyOutfitsRepo = new SqlWeeklyOutfitsSyncRepository(readDb, readDb)
  const wardrobePanoramaRepo = new SqlWardrobePanoramaSyncRepository(readDb, readDb)

  const [weeklyOutfits, wardrobePanorama] = await Promise.all([
    weeklyOutfitsRepo.findTranslatableByUserId(userId),
    wardrobePanoramaRepo.findTranslatableByUserId(userId),
  ])

  log.info("Step completed", {
    weeklyOutfitsCount: weeklyOutfits.length,
    hasWardrobePanorama: wardrobePanorama !== null,
  })

  return { weeklyOutfits, wardrobePanorama }
}
