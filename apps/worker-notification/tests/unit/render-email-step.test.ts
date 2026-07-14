import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockResolveUserLocale } = vi.hoisted(() => ({
  mockResolveUserLocale: vi.fn(),
}))

vi.mock("../../src/lib/i18n/resolve-user-locale", () => ({
  resolveUserLocale: mockResolveUserLocale,
}))

import { renderEmailStep } from "../../src/workflows/email--welcome/steps/render-email"

const payload = {
  user_id: "user-1",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
}

describe("renderEmailStep", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.EMAIL_FROM = "SkyDIIV <no-reply@skydiiv.space>"
    process.env.APP_URL = "https://skydiiv.space"
    delete process.env.EMAIL_REPLY_TO
    mockResolveUserLocale.mockResolvedValue("en-US")
  })

  afterEach(() => {
    delete process.env.EMAIL_FROM
    delete process.env.APP_URL
    delete process.env.EMAIL_REPLY_TO
  })

  it("returns a rendered email in the user's locale with a fixed English subject", async () => {
    const email = await renderEmailStep(payload)

    expect(mockResolveUserLocale).toHaveBeenCalledWith("user-1")
    expect(email.locale).toBe("en-US")
    expect(email.to).toBe("jane@example.com")
    expect(email.from).toBe("SkyDIIV <no-reply@skydiiv.space>")
    expect(email.subject).toBe("you're in — SkyDIIV")
    expect(email.html).toContain("hey, Jane.")
    expect(email.text).toContain("start now")
    expect(email.replyTo).toBeUndefined()
  })

  it("uses pt-BR copy when the user locale resolves to pt-BR", async () => {
    mockResolveUserLocale.mockResolvedValueOnce("pt-BR")
    const email = await renderEmailStep(payload)
    expect(email.html).toContain("oi, Jane.")
    expect(email.html).toContain("começar agora")
  })

  it("includes the Reply-To when EMAIL_REPLY_TO is set", async () => {
    process.env.EMAIL_REPLY_TO = "contato@skydiiv.space"
    const email = await renderEmailStep(payload)
    expect(email.replyTo).toBe("contato@skydiiv.space")
  })

  it("throws when EMAIL_FROM is not set", async () => {
    delete process.env.EMAIL_FROM
    await expect(renderEmailStep(payload)).rejects.toThrow(
      "EMAIL_FROM environment variable is not set",
    )
  })
})
