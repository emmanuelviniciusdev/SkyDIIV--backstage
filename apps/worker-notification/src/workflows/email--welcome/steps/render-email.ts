import { resolveAppUrl } from "../../../lib/app-url"
import type { EmailInlineAttachment } from "../../../lib/email/types"
import type { Locale } from "../../../lib/i18n/config"
import { resolveUserLocale } from "../../../lib/i18n/resolve-user-locale"
import { createLogger } from "../../../lib/logger"
import { renderWelcomeEmail } from "../templates/resend/welcome/index"
import type { EmailWelcomePayload } from "../types"

export interface RenderedWelcomeEmail {
  locale: Locale
  to: string
  from: string
  replyTo?: string
  subject: string
  html: string
  text: string
  attachments: EmailInlineAttachment[]
}

/**
 * Builds the welcome email from the outbox payload, resolving the user's UI
 * locale from `app_preferences` and picking the matching template copy.
 */
export async function renderEmailStep(payload: EmailWelcomePayload): Promise<RenderedWelcomeEmail> {
  const log = createLogger("render-email", payload.user_id)

  const from = process.env.EMAIL_FROM?.trim()
  if (!from) throw new Error("EMAIL_FROM environment variable is not set")
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined

  const locale = await resolveUserLocale(payload.user_id)
  const { subject, html, text, attachments } = renderWelcomeEmail({
    locale,
    firstName: payload.first_name,
    appUrl: resolveAppUrl(),
  })

  log.info("Step completed", { locale, subjectLength: subject.length, htmlLength: html.length })

  return {
    locale,
    to: payload.email,
    from,
    ...(replyTo ? { replyTo } : {}),
    subject,
    html,
    text,
    attachments,
  }
}
