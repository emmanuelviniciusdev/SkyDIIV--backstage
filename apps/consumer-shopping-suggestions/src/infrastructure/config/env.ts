import { z } from "zod"

const envSchema = z.object({
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  REDIS_STREAM_KEY: z.string().min(1).default("shopping-suggestions"),
  REDIS_CONSUMER_GROUP: z.string().min(1).default("shopping-suggestions-consumers"),
  REDIS_CONSUMER_NAME: z.string().min(1).default("consumer-1"),
  REDIS_BLOCK_MS: z.coerce.number().int().positive().default(5000),
  REDIS_CLAIM_IDLE_MS: z.coerce.number().int().positive().default(60_000),

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
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
  }

  const config = parsed.data
  if (config.SCRAPE_DELAY_MIN_MS > config.SCRAPE_DELAY_MAX_MS) {
    throw new Error("SCRAPE_DELAY_MIN_MS must be <= SCRAPE_DELAY_MAX_MS")
  }

  return config
}
