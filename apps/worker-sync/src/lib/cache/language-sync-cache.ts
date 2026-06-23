import { deleteRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
function buildLanguageSyncKey(userId: string): string {
  return `running-sync-language:${userId}`
}

/** Clears the web app's language-sync-in-progress Redis marker. */
export async function clearLanguageSyncRunning(userId: string): Promise<boolean> {
  return deleteRedisKey(buildLanguageSyncKey(userId))
}
