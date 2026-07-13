import { z } from "zod"
import type { Locale } from "../../lib/i18n/config"

/**
 * Payload delivered by `worker-outbox-events` for the `email--welcome` flow.
 * Mirrors the outbox event body the SkyDIIV web app writes on user account
 * creation (see `EMAIL_BOAS_VINDAS.md` and `app/api/register/route.ts`):
 *
 *   { user_id, first_name, last_name, email }
 */
export const emailWelcomePayloadSchema = z.object({
  user_id: z.string().min(1),
  first_name: z.string().min(1).optional(),
  last_name: z.string().optional(),
  email: z.string().email(),
})

export type EmailWelcomePayload = z.infer<typeof emailWelcomePayloadSchema>

/** Structured send failure stored in `user_notifications.notification_metadata.error`. */
export interface NotificationSendError {
  code: string
  message: string
  provider: string
  status_code?: number
  response_body?: string
}

export type WelcomeNotificationMetadata =
  | { message_id: string; locale: Locale }
  | { error: NotificationSendError; locale: Locale }

export interface EmailWelcomeResult {
  userId: string
  email: string
  messageId: string
  notificationId: string
}
