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

export function getUpstashRestCredentials(): UpstashRestCredentials {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (restUrl && restToken) {
    return { url: restUrl.replace(/\/$/, ""), token: restToken }
  }

  const redisUrl = process.env.REDIS_URL?.trim()
  if (redisUrl) {
    const parsed = parseUpstashRestFromRedisUrl(redisUrl)
    if (parsed) return parsed
  }

  throw new Error(
    "Redis credentials are not set. Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or REDIS_URL.",
  )
}

/**
 * Checks whether a Redis key exists via the Upstash REST API.
 */
export async function existsRedisKey(key: string): Promise<boolean> {
  const credentials = getUpstashRestCredentials()

  const response = await fetch(`${credentials.url}/exists/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  })

  if (!response.ok) {
    throw new Error(`Redis EXISTS failed for key "${key}" (${response.status})`)
  }

  const body: { result?: number } = await response.json()
  return body.result === 1
}

/**
 * Sets a Redis key to `"1"` with an optional TTL in seconds via the Upstash REST API.
 * If `ttlSeconds` is omitted, the key has no expiry.
 */
export async function setRedisKey(key: string, ttlSeconds?: number): Promise<void> {
  const credentials = getUpstashRestCredentials()

  const path =
    ttlSeconds !== undefined
      ? `/set/${encodeURIComponent(key)}/1/EX/${ttlSeconds}`
      : `/set/${encodeURIComponent(key)}/1`

  const response = await fetch(`${credentials.url}${path}`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  })

  if (!response.ok) {
    throw new Error(`Redis SET failed for key "${key}" (${response.status})`)
  }
}

/**
 * Atomically sets a Redis key to `"1"` with a TTL only if it does not already exist
 * (SET NX EX). Returns `true` if the key was set (lock acquired), `false` if the key
 * already existed (lock already held by another invocation).
 */
export async function setRedisKeyNx(key: string, ttlSeconds: number): Promise<boolean> {
  const credentials = getUpstashRestCredentials()

  const response = await fetch(
    `${credentials.url}/set/${encodeURIComponent(key)}/1/EX/${ttlSeconds}/NX`,
    { headers: { Authorization: `Bearer ${credentials.token}` } },
  )

  if (!response.ok) {
    throw new Error(`Redis SET NX failed for key "${key}" (${response.status})`)
  }

  const body: { result?: string | null } = await response.json()
  return body.result === "OK"
}

/**
 * Deletes a Redis key via the Upstash REST API.
 */
export async function deleteRedisKey(key: string): Promise<void> {
  const credentials = getUpstashRestCredentials()

  const response = await fetch(`${credentials.url}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${credentials.token}` },
  })

  if (!response.ok) {
    throw new Error(`Redis DEL failed for key "${key}" (${response.status})`)
  }
}
