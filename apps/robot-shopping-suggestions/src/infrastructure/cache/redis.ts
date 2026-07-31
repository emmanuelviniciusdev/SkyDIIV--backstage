import { Redis } from "ioredis"

export interface WebAppRedisRestCredentials {
  url: string
  token: string
}

/** Key/value client for the SkyDIIV web-app Redis (REST or native protocol). */
export interface WebAppRedisClient {
  readonly isConfigured: boolean
  deleteKey(key: string): Promise<boolean>
  setKey(key: string, value: string): Promise<boolean>
  close?(): Promise<void>
}

/**
 * Derives HTTP REST credentials from a TLS Redis URL (`rediss://`).
 */
export function parseRedisRestFromUrl(redisUrl: string): WebAppRedisRestCredentials | null {
  try {
    const parsed = new URL(redisUrl)
    if (parsed.protocol !== "rediss:") return null

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

/**
 * Resolves REST credentials for the SkyDIIV web-app Redis (cache / notifications).
 * Never uses a stream broker URL — the robot broker is Cloudflare Queues.
 */
export function resolveWebAppRedisRestCredentials(env: {
  webAppRedisRestUrl?: string
  webAppRedisRestToken?: string
  webAppRedisUrl?: string
}): WebAppRedisRestCredentials | null {
  const restUrl = env.webAppRedisRestUrl?.trim()
  const restToken = env.webAppRedisRestToken?.trim()
  if (restUrl && restToken) {
    return { url: restUrl.replace(/\/$/, ""), token: restToken }
  }

  if (env.webAppRedisUrl) {
    return parseRedisRestFromUrl(env.webAppRedisUrl)
  }

  return null
}

export function isPlainRedisUrl(redisUrl: string): boolean {
  return redisUrl.trim().startsWith("redis://")
}

/**
 * Production: Upstash REST (`WEB_APP_REDIS_REST_*` or `rediss://` URL).
 * Local dev: plain Redis (`redis://`, same as the web app `REDIS_URL`).
 */
export function createWebAppRedisClient(env: {
  webAppRedisRestUrl?: string
  webAppRedisRestToken?: string
  webAppRedisUrl?: string
}): WebAppRedisClient {
  const restCredentials = resolveWebAppRedisRestCredentials(env)
  if (restCredentials) {
    return new WebAppRedisRestClient(restCredentials)
  }

  const redisUrl = env.webAppRedisUrl?.trim()
  if (redisUrl && isPlainRedisUrl(redisUrl)) {
    return new WebAppNativeRedisClient(redisUrl)
  }

  return new WebAppRedisRestClient(null)
}

export class WebAppRedisRestClient implements WebAppRedisClient {
  constructor(private readonly credentials: WebAppRedisRestCredentials | null) {}

  get isConfigured(): boolean {
    return this.credentials !== null
  }

  async deleteKey(key: string): Promise<boolean> {
    if (!this.credentials) return false

    const response = await fetch(
      `${this.credentials.url}/del/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.credentials.token}` },
      },
    )

    if (!response.ok) {
      throw new Error(`Redis DEL failed (${response.status})`)
    }

    const body = (await response.json()) as { result?: number }
    return body.result === 1
  }

  async setKey(key: string, value: string): Promise<boolean> {
    if (!this.credentials) return false

    const response = await fetch(
      `${this.credentials.url}/set/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.credentials.token}` },
        body: value,
      },
    )

    if (!response.ok) {
      throw new Error(`Redis SET failed (${response.status})`)
    }

    const body = (await response.json()) as { result?: string }
    return body.result === "OK"
  }
}

export class WebAppNativeRedisClient implements WebAppRedisClient {
  private readonly client: Redis | null

  constructor(redisUrl: string) {
    if (!isPlainRedisUrl(redisUrl)) {
      this.client = null
      return
    }

    this.client = new Redis(redisUrl.trim(), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    })
  }

  get isConfigured(): boolean {
    return this.client !== null
  }

  async deleteKey(key: string): Promise<boolean> {
    if (!this.client) return false
    const deleted = await this.client.del(key)
    return deleted === 1
  }

  async setKey(key: string, value: string): Promise<boolean> {
    if (!this.client) return false
    const result = await this.client.set(key, value)
    return result === "OK"
  }

  async close(): Promise<void> {
    if (!this.client) return
    await this.client.quit()
  }
}
