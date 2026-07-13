import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ResendProvider } from "../../src/lib/email/resend.provider"

describe("ResendProvider", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key"
    delete process.env.RESEND_API_URL
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_API_URL
    vi.restoreAllMocks()
  })

  it("posts to the Resend API with auth header and returns the message id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-123" }), { status: 200 }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const provider = new ResendProvider()
    const result = await provider.send({
      to: "jane@example.com",
      from: "SkyDIIV <no-reply@skydiiv.space>",
      subject: "boas-vindas ao skydiiv",
      html: "<p>oi</p>",
      text: "oi",
      replyTo: "contato@skydiiv.space",
    })

    expect(result).toEqual({ id: "msg-123" })
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.method).toBe("POST")
    expect(headers.Authorization).toBe("Bearer re_test_key")

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      from: "SkyDIIV <no-reply@skydiiv.space>",
      to: ["jane@example.com"],
      subject: "boas-vindas ao skydiiv",
      html: "<p>oi</p>",
      text: "oi",
      reply_to: "contato@skydiiv.space",
    })
  })

  it("omits optional fields when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await new ResendProvider().send({
      to: "a@b.com",
      from: "x@y.com",
      subject: "s",
      html: "<p>h</p>",
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty("text")
    expect(body).not.toHaveProperty("reply_to")
    expect(body).not.toHaveProperty("attachments")
  })

  it("forwards inline attachments with content_id for cid: images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-2" }), { status: 200 }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await new ResendProvider().send({
      to: "jane@example.com",
      from: "no-reply@skydiiv.space",
      subject: "you're in — SkyDIIV",
      html: '<img src="cid:skydiiv-icon" />',
      attachments: [
        {
          filename: "icon--colorful.png",
          content: "aGVsbG8=",
          contentId: "skydiiv-icon",
        },
      ],
    })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as {
      attachments: Array<{ filename: string; content: string; content_id: string }>
    }
    expect(body.attachments).toEqual([
      {
        filename: "icon--colorful.png",
        content: "aGVsbG8=",
        content_id: "skydiiv-icon",
      },
    ])
  })

  it("honours RESEND_API_URL override", async () => {
    process.env.RESEND_API_URL = "https://mock.local/emails"
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await new ResendProvider().send({ to: "a@b.com", from: "x@y.com", subject: "s", html: "h" })

    expect(fetchMock.mock.calls[0][0]).toBe("https://mock.local/emails")
  })

  it("throws when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY
    await expect(
      new ResendProvider().send({ to: "a@b.com", from: "x@y.com", subject: "s", html: "h" }),
    ).rejects.toThrow("RESEND_API_KEY environment variable is not set")
  })

  it("throws on a non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("bad request", { status: 422 }),
    ) as unknown as typeof fetch

    await expect(
      new ResendProvider().send({ to: "a@b.com", from: "x@y.com", subject: "s", html: "h" }),
    ).rejects.toThrow("Resend request failed: 422")
  })

  it("throws when the response has no message id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch

    await expect(
      new ResendProvider().send({ to: "a@b.com", from: "x@y.com", subject: "s", html: "h" }),
    ).rejects.toThrow("Resend response did not include a message id")
  })
})
