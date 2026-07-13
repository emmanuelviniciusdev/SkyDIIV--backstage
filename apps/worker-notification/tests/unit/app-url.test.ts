import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { resolveAppUrl } from "../../src/lib/app-url"

describe("resolveAppUrl", () => {
  beforeEach(() => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  afterEach(() => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  it("prefers APP_URL", () => {
    process.env.APP_URL = "https://app.skydiiv.space"
    expect(resolveAppUrl()).toBe("https://app.skydiiv.space")
  })

  it("falls back to NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.skydiiv.space"
    expect(resolveAppUrl()).toBe("https://www.skydiiv.space")
  })

  it("strips trailing slashes", () => {
    process.env.APP_URL = "https://skydiiv.space/"
    expect(resolveAppUrl()).toBe("https://skydiiv.space")
  })

  it("defaults to https://skydiiv.space when nothing is set", () => {
    expect(resolveAppUrl()).toBe("https://skydiiv.space")
  })
})
