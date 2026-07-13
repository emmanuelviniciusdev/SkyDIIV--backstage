import { getEmailProvider } from "../../../lib/email"
import { createLogger } from "../../../lib/logger"
import type { NotificationSendError } from "../types"
import { normalizeSendEmailError } from "./normalize-send-error"
import type { RenderedWelcomeEmail } from "./render-email"

export type SendEmailStepResult =
  | { ok: true; provider: string; messageId: string }
  | { ok: false; provider: string; error: NotificationSendError }

/**
 * Sends the rendered welcome email through the configured email provider
 * (Resend by default). Returns a structured result instead of throwing so the
 * workflow can persist an error row in `user_notifications` before failing.
 */
export async function sendEmailStep(
  userId: string,
  email: RenderedWelcomeEmail,
): Promise<SendEmailStepResult> {
  const log = createLogger("send-email", userId)
  const provider = getEmailProvider()

  try {
    const result = await provider.send({
      to: email.to,
      from: email.from,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    })

    log.info("Step completed", { provider: provider.name, messageId: result.id })

    return { ok: true, provider: provider.name, messageId: result.id }
  } catch (err) {
    const error = normalizeSendEmailError(err, provider.name)
    log.error("Step failed", { provider: provider.name, error })
    return { ok: false, provider: provider.name, error }
  }
}
