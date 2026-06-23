import { deleteRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildWeeklyOutfitsKey(userId: string, weekStart: string): string {
  return `weekly-outfits:${userId}:${weekStart}`
}

/**
 * Returns midnight UTC on the Sunday that starts the current week (YYYY-MM-DD).
 * Must stay in sync with skydiiv web app `getWeekStartKey()`.
 */
export function getCurrentWeekStartDate(): string {
  const now = new Date()
  const weekStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()),
  )
  return weekStart.toISOString().slice(0, 10)
}

/**
 * Clears the Redis cache entry used by GET /api/weekly-outfits so the next
 * request reads fresh data from the database.
 */
export async function deleteCachedWeeklyOutfits(
  userId: string,
  weekStart: string,
): Promise<boolean> {
  return deleteRedisKey(buildWeeklyOutfitsKey(userId, weekStart))
}
