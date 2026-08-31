import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/infrastructure/config/env.js"

const requiredEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/skydiiv",
  QSTASH_TOKEN: "qstash-token",
  WORKER_OUTBOX_EVENTS_URL: "https://worker-outbox-events.example.workers.dev",
}

describe("loadConfig", () => {
  it("accepts the new required vars and boots without CF Queue ids", () => {
    const config = loadConfig(requiredEnv)
    expect(config.ROBOT_CONCURRENCY).toBe(2)
    expect(config.SCRAPE_DELAY_MIN_MS).toBe(800)
    expect(config.PROXY_URLS).toEqual([])
    expect(config.DATABASE_URL).toBe(requiredEnv.DATABASE_URL)
    expect(config.QSTASH_TOKEN).toBe("qstash-token")
    expect(config.WORKER_OUTBOX_EVENTS_URL).toBe(
      "https://worker-outbox-events.example.workers.dev",
    )
    expect(config).not.toHaveProperty("CF_ACCOUNT_ID")
    expect(config).not.toHaveProperty("CF_SCRAPE_SHOPP_SUGG_QUEUE_ID")
  })

  it("parses proxy URLs and concurrency", () => {
    const config = loadConfig({
      ...requiredEnv,
      ROBOT_CONCURRENCY: "2",
      PROXY_URLS: "socks5://proxy-a.example.com:1080, socks5://proxy-b.example.com:1080 ",
      LOG_LEVEL: "DEBUG",
    })
    expect(config.ROBOT_CONCURRENCY).toBe(2)
    expect(config.PROXY_URLS).toEqual([
      "socks5://proxy-a.example.com:1080",
      "socks5://proxy-b.example.com:1080",
    ])
    expect(config.LOG_LEVEL).toBe("DEBUG")
  })

  it("rejects missing QSTASH_TOKEN", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: requiredEnv.DATABASE_URL,
        WORKER_OUTBOX_EVENTS_URL: requiredEnv.WORKER_OUTBOX_EVENTS_URL,
      }),
    ).toThrow(/Invalid environment configuration/)
  })

  it("rejects a worker-outbox-events URL that includes a path", () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        WORKER_OUTBOX_EVENTS_URL:
          "https://worker-outbox-events.example.workers.dev/process-outbox-event",
      }),
    ).toThrow(/origin-only/)
  })

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      loadConfig({
        QSTASH_TOKEN: "qstash-token",
        WORKER_OUTBOX_EVENTS_URL: requiredEnv.WORKER_OUTBOX_EVENTS_URL,
      }),
    ).toThrow(/Invalid environment configuration/)
  })

  it("rejects inverted delay range", () => {
    expect(() =>
      loadConfig({
        ...requiredEnv,
        SCRAPE_DELAY_MIN_MS: "5000",
        SCRAPE_DELAY_MAX_MS: "100",
      }),
    ).toThrow(/SCRAPE_DELAY_MIN_MS/)
  })

  it("accepts optional web-app Redis without using it", () => {
    const config = loadConfig({
      ...requiredEnv,
      UPSTASH_REDIS_REST_URL: "https://redis.example.com",
      UPSTASH_REDIS_REST_TOKEN: "legacy-token",
    })
    expect(config.WEB_APP_REDIS_REST_URL).toBe("https://redis.example.com")
    expect(config.WEB_APP_REDIS_REST_TOKEN).toBe("legacy-token")
  })

  it("accepts optional compute provider + OCI self-delete fields", () => {
    const config = loadConfig({
      ...requiredEnv,
      COMPUTE_PROVIDER: "oci",
      OCI_COMPARTMENT_OCID: "ocid1.compartment...",
      ROBOT_DISPLAY_NAME: "skydiiv-robot-scrape-products",
      OCI_REGION: "us-ashburn-1",
      OCI_TENANCY_OCID: "ocid1.tenancy...",
      OCI_USER_OCID: "ocid1.user...",
      OCI_FINGERPRINT: "aa:bb",
      OCI_API_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----",
    })
    expect(config.COMPUTE_PROVIDER).toBe("oci")
    expect(config.OCI_COMPARTMENT_OCID).toBe("ocid1.compartment...")
    expect(config.ROBOT_DISPLAY_NAME).toBe("skydiiv-robot-scrape-products")
  })
})
