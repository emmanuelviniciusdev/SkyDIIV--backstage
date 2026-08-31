import { deleteRedisKey, setRedisKey } from "./redis"
import { createLogger } from "../logger"

/** Must stay in sync with skydiiv web app (`app/lib/cache-invalidation.ts`). */
export function buildShoppingSuggestionsKey(userId: string): string {
  return `shopping-suggestions:${userId}`
}

export function buildNewShoppingSuggestionsNotificationKey(userId: string): string {
  return `notification:new-shopping-suggestions:${userId}`
}

/**
 * Deletes the web list cache and sets the unread notification.
 * Redis failures are logged and swallowed so a successful DB swap is not rolled back.
 */
export async function notifyShoppingSuggestionsReady(userId: string): Promise<void> {
  const log = createLogger("shopping-suggestions-cache", userId)
  const listKey = buildShoppingSuggestionsKey(userId)
  const notificationKey = buildNewShoppingSuggestionsNotificationKey(userId)
  const payload = JSON.stringify({ updatedAt: new Date().toISOString() })

  try {
    await deleteRedisKey(listKey)
    await setRedisKey(notificationKey, payload)
    log.info("Shopping-suggestions cache invalidated and notification set", {
      listKey,
      notificationKey,
    })
  } catch (err) {
    log.warn("Failed to update shopping-suggestions Redis keys — swap already persisted", {
      error: err instanceof Error ? err.message : String(err),
      listKey,
      notificationKey,
    })
  }
}
