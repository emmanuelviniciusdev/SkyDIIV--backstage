import { deleteCachedWeeklyOutfits } from "../lib/cache/weekly-outfits-cache"
import { createLogger } from "../lib/logger"

export interface InvalidateWeeklyOutfitsCacheInput {
  userId: string
  weekStartDate: string
}

/**
 * Clears the skydiiv web app's weekly-outfits Redis cache for the given user/week.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function invalidateWeeklyOutfitsCacheStep(
  input: InvalidateWeeklyOutfitsCacheInput,
): Promise<void> {
  const log = createLogger("invalidate-weekly-outfits-cache", input.userId)
  log.info("Step started", { weekStartDate: input.weekStartDate })

  try {
    const deleted = await deleteCachedWeeklyOutfits(input.userId, input.weekStartDate)
    log.info("Step completed", {
      weekStartDate: input.weekStartDate,
      cacheKeyDeleted: deleted,
    })
  } catch (err) {
    log.warn("Failed to invalidate weekly outfits cache — continuing workflow", {
      weekStartDate: input.weekStartDate,
      error: String(err),
    })
  }
}
