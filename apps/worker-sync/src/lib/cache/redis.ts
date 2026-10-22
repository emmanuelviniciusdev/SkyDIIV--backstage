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

/**
 * Reads a JSON value via the Upstash REST API.
 * Returns null when the key is missing, the payload is not JSON, or Redis is not configured.
 */
export async function getRedisJson<T>(key: string): Promise<T | null> {
  const credentials = getUpstashRestCredentials()
  if (!credentials) return null

  const response = await fetch(credentials.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["GET", key]),
  })

  if (!response.ok) {
    throw new Error(`Redis GET failed (${response.status})`)
  }

  const body: { result?: string | null } = await response.json()
  if (body.result == null || body.result === "") return null
  try {
    return JSON.parse(body.result) as T
  } catch {
    return null
  }
}

/**
 * Stores a JSON value with a TTL via the Upstash REST API.
 * Returns false when Redis is not configured.
 */
export async function setRedisJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const credentials = getUpstashRestCredentials()
  if (!credentials) return false

  const ttl = Math.max(1, Math.floor(ttlSeconds))
  const response = await fetch(credentials.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", key, JSON.stringify(value), "EX", ttl]),
  })

  if (!response.ok) {
    throw new Error(`Redis SET failed (${response.status})`)
  }

  const body: { result?: string } = await response.json()
  return body.result === "OK"
}
