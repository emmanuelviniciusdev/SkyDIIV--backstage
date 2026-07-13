import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockSend, mockGetEmailProvider } = vi.hoisted(() => {
  const mockSend = vi.fn()
  return {
    mockSend,
    mockGetEmailProvider: vi.fn(() => ({ name: "resend", send: mockSend })),
  }
})

vi.mock("../../src/lib/email", () => ({
  getEmailProvider: mockGetEmailProvider,
}))

import { sendEmailStep } from "../../src/workflows/email--welcome/steps/send-email"

const email = {
  locale: "pt-BR" as const,
  to: "jane@example.com",
  from: "SkyDIIV <no-reply@skydiiv.space>",
  subject: "bem-vinda ao SkyDIIV",
  html: "<p>oi</p>",
  text: "oi",
  attachments: [],
}

describe("sendEmailStep", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns ok:true with provider + message id on success", async () => {
    mockSend.mockResolvedValue({ id: "msg-42" })

    const result = await sendEmailStep("user-1", email)

    expect(result).toEqual({ ok: true, provider: "resend", messageId: "msg-42" })
    expect(mockSend).toHaveBeenCalledWith({
      to: email.to,
      from: email.from,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments,
    })
  })

  it("forwards the replyTo when present", async () => {
    mockSend.mockResolvedValue({ id: "msg-1" })
    await sendEmailStep("user-1", { ...email, replyTo: "contato@skydiiv.space" })
    expect(mockSend.mock.calls[0][0]).toMatchObject({ replyTo: "contato@skydiiv.space" })
  })

  it("returns ok:false with structured error metadata instead of throwing", async () => {
    mockSend.mockRejectedValue(new Error('Resend request failed: 500 — upstream error'))

    const result = await sendEmailStep("user-1", email)

    expect(result).toEqual({
      ok: false,
      provider: "resend",
      error: {
        code: "provider_request_failed",
        message: "Resend request failed: 500 — upstream error",
        provider: "resend",
        status_code: 500,
        response_body: "upstream error",
      },
    })
  })
})
