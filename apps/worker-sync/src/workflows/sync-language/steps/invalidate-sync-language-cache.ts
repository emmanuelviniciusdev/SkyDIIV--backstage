import { deleteCachedRunningSyncLanguage } from "../../../lib/cache/sync-language-cache"
import { createLogger } from "../../../lib/logger"

/**
 * Clears the skydiiv web app's running-sync-language Redis marker after the workflow finishes.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function invalidateSyncLanguageCacheStep(userId: string): Promise<void> {
  const log = createLogger("invalidate-sync-language-cache", userId)
  log.info("Step started")

  try {
    const deleted = await deleteCachedRunningSyncLanguage(userId)
    log.info("Step completed", { cacheKeyDeleted: deleted })
  } catch (err) {
    log.warn("Failed to invalidate sync-language cache — continuing workflow", {
      error: String(err),
    })
  }
}
