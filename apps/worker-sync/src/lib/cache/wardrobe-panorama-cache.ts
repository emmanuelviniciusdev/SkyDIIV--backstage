import { deleteRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildWardrobePanoramaKey(userId: string): string {
  return `wardrobe-panorama:${userId}`
}

/**
 * Clears the Redis cache entry used by GET /api/wardrobe-panorama so the next
 * request reads fresh data from the database.
 */
export async function deleteCachedWardrobePanorama(userId: string): Promise<boolean> {
  return deleteRedisKey(buildWardrobePanoramaKey(userId))
}
