import type { NotificationSendError } from "../types"

const PROVIDER_REQUEST_FAILED_RE = /^Resend request failed: (\d+)(?: — (.*))?$/

/**
 * Maps a thrown send error into the structured shape persisted under
 * `user_notifications.notification_metadata.error`.
 */
export function normalizeSendEmailError(err: unknown, provider: string): NotificationSendError {
  if (!(err instanceof Error)) {
    return {
      code: "send_failed",
      message: String(err),
      provider,
    }
  }

  const resendMatch = PROVIDER_REQUEST_FAILED_RE.exec(err.message)
  if (resendMatch) {
    return {
      code: "provider_request_failed",
      message: err.message,
      provider,
      status_code: Number(resendMatch[1]),
      ...(resendMatch[2] ? { response_body: resendMatch[2] } : {}),
    }
  }

  if (err.message.includes("RESEND_API_KEY")) {
    return { code: "missing_api_key", message: err.message, provider }
  }

  if (err.message.includes("did not include a message id")) {
    return { code: "invalid_provider_response", message: err.message, provider }
  }

  if (err.message.includes("EMAIL_FROM")) {
    return { code: "missing_sender", message: err.message, provider }
  }

  return { code: "send_failed", message: err.message, provider }
}
