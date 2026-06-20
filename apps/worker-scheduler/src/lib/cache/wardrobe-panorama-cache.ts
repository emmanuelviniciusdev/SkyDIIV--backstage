import { existsRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app and worker-ai-workflows */
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
 * Keeps only users whose wardrobe-update-check cache marker is present.
 * Used by the scheduler to avoid dispatching workflow runs that would no-op.
 */
export async function filterUsersWithWardrobeUpdateCheck<T extends { userId: string }>(
  users: T[],
): Promise<T[]> {
  if (users.length === 0) return []

  const checks = await Promise.all(
    users.map(async (user) => ({
      user,
      hasUpdate: await hasWardrobeUpdateCheck(user.userId),
    })),
  )

  return checks.filter(({ hasUpdate }) => hasUpdate).map(({ user }) => user)
}
