import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/infrastructure/config/env.js"

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({})
    expect(config.CONSUMER_CONCURRENCY).toBe(10)
    expect(config.REDIS_STREAM_KEY).toBe("shopping-suggestions")
    expect(config.SCRAPE_DELAY_MIN_MS).toBe(800)
    expect(config.PROXY_URLS).toEqual([])
  })

  it("parses proxy URLs and concurrency", () => {
    const config = loadConfig({
      CONSUMER_CONCURRENCY: "5",
      PROXY_URLS: "socks5://127.0.0.1:11080, socks5://127.0.0.1:11081 ",
      LOG_LEVEL: "DEBUG",
    })
    expect(config.CONSUMER_CONCURRENCY).toBe(5)
    expect(config.PROXY_URLS).toEqual([
      "socks5://127.0.0.1:11080",
      "socks5://127.0.0.1:11081",
    ])
    expect(config.LOG_LEVEL).toBe("DEBUG")
  })

  it("rejects inverted delay range", () => {
    expect(() =>
      loadConfig({
        SCRAPE_DELAY_MIN_MS: "5000",
        SCRAPE_DELAY_MAX_MS: "100",
      }),
    ).toThrow(/SCRAPE_DELAY_MIN_MS/)
  })
})
