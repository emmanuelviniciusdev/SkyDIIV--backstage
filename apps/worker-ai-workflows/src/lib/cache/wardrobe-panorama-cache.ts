import { deleteRedisKey, existsRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildWardrobeUpdateCheckKey(userId: string): string {
  return `wardrobe-update-check:${userId}--wardrobe-panorama`
}

/** Must stay in sync with skydiiv web app */
function buildWardrobePanoramaKey(userId: string): string {
  return `wardrobe-panorama:${userId}`
}

/** Redis keys invalidated after a successful panorama generation. */
function buildWardrobePanoramaCacheKeys(userId: string): string[] {
  return [buildWardrobeUpdateCheckKey(userId), buildWardrobePanoramaKey(userId)]
}

/**
 * Returns true when the web app has marked this user's wardrobe as needing a
 * panorama refresh (wardrobe-update-check:{userId}--wardrobe-panorama in Redis).
 */
export async function hasWardrobeUpdateCheck(userId: string): Promise<boolean> {
  return existsRedisKey(buildWardrobeUpdateCheckKey(userId))
}

export interface WardrobePanoramaCacheInvalidation {
  key: string
  deleted: boolean
}

/**
 * Clears all wardrobe-panorama-related Redis cache entries for the user.
 */
export async function invalidateWardrobePanoramaCaches(
  userId: string,
): Promise<WardrobePanoramaCacheInvalidation[]> {
  const keys = buildWardrobePanoramaCacheKeys(userId)
  const results: WardrobePanoramaCacheInvalidation[] = []

  for (const key of keys) {
    results.push({ key, deleted: await deleteRedisKey(key) })
  }

  return results
}
