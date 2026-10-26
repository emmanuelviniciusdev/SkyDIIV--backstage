export interface UpstashRestCredentials {
  url: string
  token: string
}

/**
 * Derives Upstash REST credentials from a standard Redis URL.
 * Upstash URLs look like: rediss://default:<token>@<host>.upstash.io:6379
 */
export function parseUpstashRestFromRedisUrl(redisUrl: string): UpstashRestCredentials | null {
  try {
    const parsed = new URL(redisUrl)
    if (!parsed.hostname.includes("upstash.io")) return null

    const token = decodeURIComponent(parsed.password)
    if (!token) return null

    return {
      url: `https://${parsed.hostname}`,
      token,
    }
  } catch {
    return null
  }
}

export function getUpstashRestCredentials(): UpstashRestCredentials | null {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (restUrl && restToken) {
    return { url: restUrl.replace(/\/$/, ""), token: restToken }
  }

  const redisUrl = process.env.REDIS_URL?.trim()
  if (redisUrl) {
    return parseUpstashRestFromRedisUrl(redisUrl)
  }

  return null
}

/**
 * Deletes a Redis key via the Upstash REST API (works in Cloudflare Workers).
 * Returns true when the key was deleted, false when it did not exist or Redis is not configured.
 */
export async function deleteRedisKey(key: string): Promise<boolean> {
  const credentials = getUpstashRestCredentials()
  if (!credentials) return false

  const response = await fetch(`${credentials.url}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Redis DEL failed (${response.status})`)
  }

  const body: { result?: number } = await response.json()
  return body.result === 1
}
