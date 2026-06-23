import { deleteRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildRunningSyncLanguageKey(userId: string): string {
  return `running-sync-language:${userId}`
}

/**
 * Clears the web app's "sync language in progress" Redis marker for the user.
 */
export async function deleteCachedRunningSyncLanguage(userId: string): Promise<boolean> {
  return deleteRedisKey(buildRunningSyncLanguageKey(userId))
}
