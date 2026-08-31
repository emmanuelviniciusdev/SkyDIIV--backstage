import { z } from "zod"

function originOnlyUrl(value: string, envVar: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${envVar} must be a valid origin URL`)
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(`${envVar} must be origin-only (no path)`)
  }
  return value.replace(/\/$/, "")
}

const envSchema = z.object({
  QSTASH_TOKEN: z.string().min(1),
  QSTASH_URL: z.string().optional(),
  WORKER_OUTBOX_EVENTS_URL: z.string().min(1),

  /** Postgres pooled connection — SELECTs */
  DATABASE_URL: z.string().min(1),
  /** Postgres direct connection — writes / transactions (falls back to DATABASE_URL) */
  DATABASE_URL_UNPOOLED: z.string().optional(),

  /**
   * REST credentials for the SkyDIIV web-app Redis (unused by automatic thrifting).
   */
  WEB_APP_REDIS_REST_URL: z.string().optional(),
  WEB_APP_REDIS_REST_TOKEN: z.string().optional(),
  WEB_APP_REDIS_URL: z.string().optional(),

  ROBOT_CONCURRENCY: z.coerce.number().int().positive().default(2),

  SCRAPE_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(800),
  SCRAPE_DELAY_MAX_MS: z.coerce.number().int().positive().default(2500),

  CAMOUFOX_HEADLESS: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  CAMOUFOX_INSTALL_DIR: z.string().optional(),

  PROXY_URLS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  COMPUTE_PROVIDER: z.string().optional(),

  OCI_CONTAINER_INSTANCE_OCID: z.string().optional(),
  OCI_COMPARTMENT_OCID: z.string().optional(),
  ROBOT_DISPLAY_NAME: z.string().optional(),
  OCI_REGION: z.string().optional(),
  OCI_TENANCY_OCID: z.string().optional(),
  OCI_USER_OCID: z.string().optional(),
  OCI_FINGERPRINT: z.string().optional(),
  OCI_API_PRIVATE_KEY: z.string().optional(),

  SELF_DELETE_WAIT_ACTIVE_MS: z.coerce.number().int().positive().default(240_000),
  SELF_DELETE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  SELF_DELETE_ACTIVE_GRACE_MS: z.coerce.number().int().nonnegative().default(120_000),

  LOG_LEVEL: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
})

export type AppConfig = z.infer<typeof envSchema>

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

  originOnlyUrl(config.WORKER_OUTBOX_EVENTS_URL, "WORKER_OUTBOX_EVENTS_URL")

  return config
}
