import { invalidateWardrobePanoramaCaches } from "../../../lib/cache/wardrobe-panorama-cache"
import { createLogger } from "../../../lib/logger"

/**
 * Clears all wardrobe-panorama-related Redis cache entries after a successful run.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function invalidateWardrobePanoramaCacheStep(userId: string): Promise<void> {
  const log = createLogger("invalidate-wardrobe-panorama-cache", userId)
  log.info("Step started")

  try {
    const results = await invalidateWardrobePanoramaCaches(userId)
    log.info("Step completed", { cacheInvalidation: results })
  } catch (err) {
    log.warn("Failed to invalidate wardrobe panorama cache — continuing workflow", {
      error: String(err),
    })
  }
}
