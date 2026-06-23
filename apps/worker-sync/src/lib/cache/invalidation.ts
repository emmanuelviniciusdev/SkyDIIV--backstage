import { clearLanguageSyncRunning } from "./language-sync-cache"
import { deleteCachedWeeklyOutfits, getCurrentWeekStartDate } from "./weekly-outfits-cache"
import { deleteCachedWardrobePanorama } from "./wardrobe-panorama-cache"

/** Must stay in sync with skydiiv web app `CACHE_TARGETS` where applicable. */
export const CACHE_TARGETS = {
  WEEKLY_OUTFITS: "weekly-outfits",
  WARDROBE_PANORAMA: "wardrobe-panorama",
  LANGUAGE_SYNC_RUNNING: "language-sync-running",
} as const

export type CacheTarget = (typeof CACHE_TARGETS)[keyof typeof CACHE_TARGETS]

export interface CacheInvalidationResult {
  target: CacheTarget
  key: string
  deleted: boolean
}

export async function invalidateCache(
  userId: string,
  target: CacheTarget,
): Promise<CacheInvalidationResult> {
  switch (target) {
    case CACHE_TARGETS.WEEKLY_OUTFITS: {
      const weekStart = getCurrentWeekStartDate()
      return {
        target,
        key: `weekly-outfits:${userId}:${weekStart}`,
        deleted: await deleteCachedWeeklyOutfits(userId, weekStart),
      }
    }
    case CACHE_TARGETS.WARDROBE_PANORAMA:
      return {
        target,
        key: `wardrobe-panorama:${userId}`,
        deleted: await deleteCachedWardrobePanorama(userId),
      }
    case CACHE_TARGETS.LANGUAGE_SYNC_RUNNING:
      return {
        target,
        key: `running-sync-language:${userId}`,
        deleted: await clearLanguageSyncRunning(userId),
      }
    default: {
      const exhaustive: never = target
      throw new Error(`Unknown cache target: ${exhaustive}`)
    }
  }
}

export async function invalidateCaches(
  userId: string,
  targets: CacheTarget[],
): Promise<CacheInvalidationResult[]> {
  const uniqueTargets = [...new Set(targets)]
  const results: CacheInvalidationResult[] = []

  for (const target of uniqueTargets) {
    results.push(await invalidateCache(userId, target))
  }

  return results
}
