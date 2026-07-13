import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types"

const DEFAULT_API_URL = "https://api.resend.com/emails"

interface ResendRequestBody {
  from: string
  to: string[]
  subject: string
  html: string
  text?: string
  reply_to?: string
}

interface ResendResponse {
  id?: string
}

/**
 * Transactional email provider backed by Resend (https://resend.com).
 *
 * Talks to the Resend REST API directly with `fetch` (no SDK) to stay
 * Workers-friendly, mirroring how the LLM/weather providers are implemented
 * in the other workers.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend"

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set")

    const url = process.env.RESEND_API_URL ?? DEFAULT_API_URL

    const body: ResendRequestBody = {
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Resend request failed: ${res.status} — ${text}`)
    }

    const json: ResendResponse = await res.json()
    if (!json.id) {
      throw new Error("Resend response did not include a message id")
    }

    return { id: json.id }
  }
}
