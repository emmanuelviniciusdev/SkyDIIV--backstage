import { clearWardrobeUpdateCheck } from "../../../lib/cache/wardrobe-update-check-cache"
import { createLogger } from "../../../lib/logger"

/**
 * Clears the wardrobe-update-check Redis marker after a successful panorama run.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function clearWardrobeUpdateCheckStep(userId: string): Promise<void> {
  const log = createLogger("clear-wardrobe-update-check", userId)
  log.info("Step started")

  try {
    const deleted = await clearWardrobeUpdateCheck(userId)
    log.info("Step completed", { cacheKeyDeleted: deleted })
  } catch (err) {
    log.warn("Failed to clear wardrobe-update-check marker — continuing workflow", {
      error: String(err),
    })
  }
}
