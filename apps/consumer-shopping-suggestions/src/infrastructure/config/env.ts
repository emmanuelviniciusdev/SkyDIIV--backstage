import { z } from "zod"

const envSchema = z.object({
  /**
   * Cloudflare Queues HTTP pull — **default / active broker**.
   */
  CF_ACCOUNT_ID: z.string().min(1),
  CF_SCRAPE_SHOPP_SUGG_QUEUE_ID: z.string().min(1),
  CF_QUEUES_API_TOKEN: z.string().min(1),
  /** Max messages pulled per poll cycle (default: 10). */
  CF_QUEUES_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  /** Delay between poll cycles in ms (default: 10 minutes). */
  CF_QUEUES_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(600_000),
  /**
   * Lease duration while processing a pulled batch (default: 2 hours).
   * Must cover worst-case scrape time for the whole batch.
   */
  CF_QUEUES_VISIBILITY_TIMEOUT_MS: z.coerce.number().int().positive().default(7_200_000),

  /**
   * REST credentials for the SkyDIIV web-app Redis.
   * Used for `shopping-suggestions:{userId}` and
   * `notification:new-shopping-suggestions:{userId}`.
   */
  WEB_APP_REDIS_REST_URL: z.string().optional(),
  WEB_APP_REDIS_REST_TOKEN: z.string().optional(),
  /** Optional web-app Redis URL fallback when REST vars are missing. */
  WEB_APP_REDIS_URL: z.string().optional(),

  /** Postgres pooled connection — SELECTs */
  DATABASE_URL: z.string().min(1),
  /** Postgres direct connection — writes / transactions (falls back to DATABASE_URL) */
  DATABASE_URL_UNPOOLED: z.string().optional(),

  CONSUMER_CONCURRENCY: z.coerce.number().int().positive().default(10),

  SCRAPE_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(800),
  SCRAPE_DELAY_MAX_MS: z.coerce.number().int().positive().default(2500),

  CAMOUFOX_HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  CAMOUFOX_INSTALL_DIR: z.string().optional(),

  /**
   * Comma-separated proxy URLs for outbound scrape rotation.
   * Provisioned by infrastructure (never raw IPv6 addresses).
   * Example: socks5://127.0.0.1:11080,socks5://127.0.0.1:11081
   */
  PROXY_URLS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
})

export type AppConfig = z.infer<typeof envSchema>

/**
 * Loads and validates process environment into a typed config object.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse({
    ...env,
    WEB_APP_REDIS_REST_URL: env.WEB_APP_REDIS_REST_URL ?? env.UPSTASH_REDIS_REST_URL,
    WEB_APP_REDIS_REST_TOKEN: env.WEB_APP_REDIS_REST_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN,
  })
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
  }

  const config = parsed.data
  if (config.SCRAPE_DELAY_MIN_MS > config.SCRAPE_DELAY_MAX_MS) {
    throw new Error("SCRAPE_DELAY_MIN_MS must be <= SCRAPE_DELAY_MAX_MS")
  }

  return config
}
