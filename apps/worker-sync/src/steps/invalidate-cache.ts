import { invalidateCaches, type CacheTarget } from "../lib/cache/invalidation"
import { createLogger } from "../lib/logger"

export interface InvalidateCacheInput {
  userId: string
  targets: CacheTarget[]
}

/**
 * Clears one or more skydiiv web app Redis cache entries.
 * Non-fatal when Redis is unavailable — logs a warning and continues.
 */
export async function invalidateCacheStep(input: InvalidateCacheInput): Promise<void> {
  const log = createLogger("invalidate-cache", input.userId)
  log.info("Step started", { targets: input.targets })

  try {
    const results = await invalidateCaches(input.userId, input.targets)
    log.info("Step completed", { results })
  } catch (err) {
    log.warn("Failed to invalidate cache — continuing workflow", {
      targets: input.targets,
      error: String(err),
    })
  }
}
