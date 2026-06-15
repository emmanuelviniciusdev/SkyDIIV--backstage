import { deleteRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildWeeklyOutfitsKey(userId: string, weekStart: string): string {
  return `weekly-outfits:${userId}:${weekStart}`
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
