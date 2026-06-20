import { setNewWeeklyOutfitsNotification } from "../../../lib/cache/notification-cache"
import { createLogger } from "../../../lib/logger"

/**
 * Marks new weekly outfits as unread in the skydiiv web app notification cache.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function setWeeklyOutfitsNotificationStep(userId: string): Promise<void> {
  const log = createLogger("set-weekly-outfits-notification", userId)
  log.info("Step started")

  try {
    const notificationSet = await setNewWeeklyOutfitsNotification(userId)
    log.info("Step completed", { notificationSet })
  } catch (err) {
    log.warn("Failed to set weekly outfits notification — continuing workflow", {
      error: String(err),
    })
  }
}
