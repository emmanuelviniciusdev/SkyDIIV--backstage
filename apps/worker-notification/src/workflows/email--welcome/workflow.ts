import { createWorkflow } from "@upstash/workflow/cloudflare"
import { resetDbClients } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"
import { renderEmailStep } from "./steps/render-email"
import { sendEmailStep } from "./steps/send-email"
import {
  NOTIFICATION_SEND_STATUS,
  recordNotificationStep,
} from "./steps/record-notification"
import { emailWelcomePayloadSchema, type EmailWelcomePayload, type EmailWelcomeResult } from "./types"

export type { EmailWelcomePayload } from "./types"

/**
 * email--welcome — Upstash Workflow (Cloudflare Workers)
 *
 * Triggered by `worker-outbox-events` when the SkyDIIV web app records a
 * `email--welcome / user-account-creation` outbox event on user registration.
 *
 * Steps:
 *   render-email        → build the branded welcome email (Resend template)
 *   send-email          → deliver it via the configured email provider (Resend)
 *   record-notification → INSERT user_notifications (status = success | error)
 *
 * On send failure the workflow still records `notification_send_status = error`
 * with a structured `notification_metadata.error` object, then throws so the
 * outbox consumer can mark the event as ERROR and QStash can retry.
 */
export const emailWelcomeWorkflow = createWorkflow<EmailWelcomePayload, void>(
  async (context) => {
    const parsed = emailWelcomePayloadSchema.safeParse(context.requestPayload)
    const log = createLogger(
      "email--welcome",
      parsed.success ? parsed.data.user_id : undefined,
    )

    if (!parsed.success) {
      log.error("Invalid workflow payload", { issues: parsed.error.issues })
      throw new Error("Workflow payload must include user_id and a valid email")
    }

    const payload = parsed.data
    log.info("Workflow started")

    resetDbClients()
    log.debug("DB clients reset")

    log.info("Starting step: render-email")
    const email = await context.run("render-email", async () => {
      return renderEmailStep(payload)
    })
    log.info("Step completed: render-email", { subject: email.subject })

    log.info("Starting step: send-email")
    const sendResult = await context.run("send-email", async () => {
      return sendEmailStep(payload.user_id, email)
    })

    if (sendResult.ok) {
      log.info("Step completed: send-email", { messageId: sendResult.messageId })
    } else {
      log.warn("Step completed: send-email (failed)", { error: sendResult.error })
    }

    log.info("Starting step: record-notification")
    const record = await context.run("record-notification", async () => {
      if (sendResult.ok) {
        return recordNotificationStep({
          userId: payload.user_id,
          service: sendResult.provider,
          status: NOTIFICATION_SEND_STATUS.SUCCESS,
          metadata: { message_id: sendResult.messageId, locale: email.locale },
        })
      }

      return recordNotificationStep({
        userId: payload.user_id,
        service: sendResult.provider,
        status: NOTIFICATION_SEND_STATUS.ERROR,
        metadata: { error: sendResult.error, locale: email.locale },
      })
    })
    log.info("Step completed: record-notification", {
      notificationId: record.notificationId,
      status: sendResult.ok ? "success" : "error",
    })

    if (!sendResult.ok) {
      throw new Error(`Failed to send welcome email: ${sendResult.error.message}`)
    }

    const result: EmailWelcomeResult = {
      userId: payload.user_id,
      email: payload.email,
      messageId: sendResult.messageId,
      notificationId: record.notificationId,
    }

    log.info("Workflow completed", { ...result })
  },
)
