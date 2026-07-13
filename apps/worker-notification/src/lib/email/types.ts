export interface SendEmailInput {
  /** Recipient address. */
  to: string
  /** Verified sender identity, e.g. "SkyDIIV <no-reply@skydiiv.space>". */
  from: string
  subject: string
  /** Rendered HTML body. */
  html: string
  /** Optional plain-text fallback body. */
  text?: string
  /** Optional Reply-To header. */
  replyTo?: string
}

export interface SendEmailResult {
  /** Provider-assigned message identifier (stored in user_notifications.metadata). */
  id: string
}

export interface EmailProvider {
  /** Unique key identifying this provider (stored in user_notifications.notification_service). */
  readonly name: string
  /**
   * Sends a transactional email and returns the provider message id.
   * Throws on network errors or non-OK status codes.
   */
  send(input: SendEmailInput): Promise<SendEmailResult>
}

export type EmailProviderFactory = () => EmailProvider
