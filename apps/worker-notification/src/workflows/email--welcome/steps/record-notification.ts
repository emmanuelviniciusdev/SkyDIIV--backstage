import { getWriteDb } from "../../../lib/db/client"
import {
  NOTIFICATION_SEND_STATUS,
  SqlUserNotificationsRepository,
  type NotificationSendStatus,
} from "../../../lib/db/user-notifications.repository"
import { createLogger } from "../../../lib/logger"
import type { WelcomeNotificationMetadata } from "../types"

export const WELCOME_NOTIFICATION_TYPE = "welcome"

export interface RecordNotificationInput {
  userId: string
  service: string
  status: NotificationSendStatus
  metadata: WelcomeNotificationMetadata
}

export interface RecordNotificationResult {
  notificationId: string
}

/**
 * Inserts a row into `user_notifications` describing the send outcome.
 *
 * Success metadata: `{ message_id, locale }`
 * Error metadata:   `{ error: { code, message, provider, ... }, locale }`
 */
export async function recordNotificationStep(
  input: RecordNotificationInput,
): Promise<RecordNotificationResult> {
  const log = createLogger("record-notification", input.userId)

  const repo = new SqlUserNotificationsRepository(getWriteDb())
  const { id } = await repo.insert({
    userId: input.userId,
    notificationType: WELCOME_NOTIFICATION_TYPE,
    notificationService: input.service,
    notificationMetadata: input.metadata,
    notificationSendStatus: input.status,
  })

  log.info("Step completed", {
    notificationId: id,
    status: input.status,
  })

  return { notificationId: id }
}

export { NOTIFICATION_SEND_STATUS }
