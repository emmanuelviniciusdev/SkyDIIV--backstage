import { deleteRedisKey, existsRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildWardrobeUpdateCheckKey(userId: string): string {
  return `wardrobe-update-check:${userId}--wardrobe-panorama`
}

/**
 * Returns true when the web app has marked this user's wardrobe as needing a
 * panorama refresh (wardrobe-update-check:{userId}--wardrobe-panorama in Redis).
 */
export async function hasWardrobeUpdateCheck(userId: string): Promise<boolean> {
  return existsRedisKey(buildWardrobeUpdateCheckKey(userId))
}

/**
 * Removes the wardrobe-update-check marker after a panorama has been generated.
 */
export async function clearWardrobeUpdateCheck(userId: string): Promise<boolean> {
  return deleteRedisKey(buildWardrobeUpdateCheckKey(userId))
}
