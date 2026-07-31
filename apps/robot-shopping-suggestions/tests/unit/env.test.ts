import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/infrastructure/config/env.js"

const requiredEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/skydiiv",
  CF_ACCOUNT_ID: "acc-1",
  CF_SCRAPE_SHOPP_SUGG_QUEUE_ID: "queue-1",
  CF_QUEUES_API_TOKEN: "token-1",
}

describe("loadConfig", () => {
  it("applies defaults for batch-drain robot (2 at a time)", () => {
    const config = loadConfig(requiredEnv)
    expect(config.ROBOT_CONCURRENCY).toBe(2)
    expect(config.CF_QUEUES_BATCH_SIZE).toBe(2)
    expect(config.SCRAPE_DELAY_MIN_MS).toBe(800)
    expect(config.PROXY_URLS).toEqual([])
    expect(config.DATABASE_URL).toBe(requiredEnv.DATABASE_URL)
    expect(config.CF_ACCOUNT_ID).toBe("acc-1")
    expect(config.CF_SCRAPE_SHOPP_SUGG_QUEUE_ID).toBe("queue-1")
    expect(config.CF_QUEUES_API_TOKEN).toBe("token-1")
    expect(config.CF_QUEUES_VISIBILITY_TIMEOUT_MS).toBe(7_200_000)
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

  it("parses Cloudflare Queues batch and visibility overrides", () => {
    const config = loadConfig({
      ...requiredEnv,
      CF_QUEUES_BATCH_SIZE: "2",
      CF_QUEUES_VISIBILITY_TIMEOUT_MS: "5400000",
    })
    expect(config.CF_QUEUES_BATCH_SIZE).toBe(2)
    expect(config.CF_QUEUES_VISIBILITY_TIMEOUT_MS).toBe(5_400_000)
  })

  it("rejects missing Cloudflare Queues credentials", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: requiredEnv.DATABASE_URL,
      }),
    ).toThrow(/Invalid environment configuration/)
  })

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      loadConfig({
        CF_ACCOUNT_ID: "acc-1",
        CF_SCRAPE_SHOPP_SUGG_QUEUE_ID: "queue-1",
        CF_QUEUES_API_TOKEN: "token-1",
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

  it("accepts legacy web-app Redis REST env aliases", () => {
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
      ROBOT_DISPLAY_NAME: "skydiiv-robot-shopping-suggestions",
      OCI_REGION: "us-ashburn-1",
      OCI_TENANCY_OCID: "ocid1.tenancy...",
      OCI_USER_OCID: "ocid1.user...",
      OCI_FINGERPRINT: "aa:bb",
      OCI_API_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----",
    })
    expect(config.COMPUTE_PROVIDER).toBe("oci")
    expect(config.OCI_COMPARTMENT_OCID).toBe("ocid1.compartment...")
    expect(config.ROBOT_DISPLAY_NAME).toBe("skydiiv-robot-shopping-suggestions")
  })
})
