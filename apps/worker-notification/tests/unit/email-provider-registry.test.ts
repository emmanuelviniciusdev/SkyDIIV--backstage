import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  getEmailProvider,
  registerEmailProvider,
  type EmailProvider,
} from "../../src/lib/email"
import { ResendProvider } from "../../src/lib/email/resend.provider"

describe("email provider registry", () => {
  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER
  })

  afterEach(() => {
    delete process.env.EMAIL_PROVIDER
  })

  it("returns the Resend provider by default", () => {
    expect(getEmailProvider()).toBeInstanceOf(ResendProvider)
    expect(getEmailProvider().name).toBe("resend")
  })

  it("resolves the provider from the EMAIL_PROVIDER env var", () => {
    process.env.EMAIL_PROVIDER = "resend"
    expect(getEmailProvider()).toBeInstanceOf(ResendProvider)
  })

  it("prefers the explicit name argument over the env var", () => {
    const fake: EmailProvider = {
      name: "fake",
      send: async () => ({ id: "x" }),
    }
    registerEmailProvider("fake", () => fake)
    expect(getEmailProvider("fake")).toBe(fake)
  })

  it("throws for an unregistered provider", () => {
    expect(() => getEmailProvider("does-not-exist")).toThrow(
      'Email provider "does-not-exist" is not registered',
    )
  })
})
