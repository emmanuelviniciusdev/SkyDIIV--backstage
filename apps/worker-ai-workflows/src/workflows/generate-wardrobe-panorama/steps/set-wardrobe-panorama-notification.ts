import { setNewWardrobePanoramaNotification } from "../../../lib/cache/notification-cache"
import { createLogger } from "../../../lib/logger"

/**
 * Marks new wardrobe panorama as unread in the skydiiv web app notification cache.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function setWardrobePanoramaNotificationStep(userId: string): Promise<void> {
  const log = createLogger("set-wardrobe-panorama-notification", userId)
  log.info("Step started")

  try {
    const notificationSet = await setNewWardrobePanoramaNotification(userId)
    log.info("Step completed", { notificationSet })
  } catch (err) {
    log.warn("Failed to set wardrobe panorama notification — continuing workflow", {
      error: String(err),
    })
  }
}
