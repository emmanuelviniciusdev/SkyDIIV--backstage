import type { CachePort } from "../../domain/ports/cache.port.js"
import type { Logger } from "../../domain/ports/logger.port.js"
import type { WebAppRedisClient } from "./redis.js"

/** Must stay in sync with skydiiv web app */
function buildShoppingSuggestionsKey(userId: string): string {
  return `shopping-suggestions:${userId}`
}

function buildNewShoppingSuggestionsNotificationKey(userId: string): string {
  return `notification:new-shopping-suggestions:${userId}`
}

/**
 * Writes to the SkyDIIV web-app Redis, not the consumer stream broker.
 */
export class WebAppCacheAdapter implements CachePort {
  constructor(
    private readonly redis: WebAppRedisClient,
    private readonly logger: Logger,
  ) {}

  async invalidateShoppingSuggestions(userId: string): Promise<void> {
    const key = buildShoppingSuggestionsKey(userId)
    if (!this.redis.isConfigured) {
      this.logger.warn("Skipping shopping-suggestions cache invalidation — web Redis not configured", {
        key,
      })
      return
    }

    const deleted = await this.redis.deleteKey(key)
    this.logger.info("Invalidated shopping-suggestions cache", { key, deleted })
  }

  async setNewShoppingSuggestionsNotification(userId: string): Promise<void> {
    const key = buildNewShoppingSuggestionsNotificationKey(userId)
    if (!this.redis.isConfigured) {
      this.logger.warn("Skipping shopping-suggestions notification — web Redis not configured", {
        key,
      })
      return
    }

    const value = JSON.stringify({ updatedAt: new Date().toISOString() })
    const ok = await this.redis.setKey(key, value)
    this.logger.info("Set new-shopping-suggestions notification", { key, ok })
  }
}
