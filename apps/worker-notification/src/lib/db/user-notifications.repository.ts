import type postgres from "postgres"

/**
 * Send-status values for the `user_notifications.notification_send_status`
 * column. Mirrors the Prisma enum `UserNotificationSendStatus` defined in the
 * SkyDIIV web app schema.
 */
export const NOTIFICATION_SEND_STATUS = {
  PENDING: "pending",
  SUCCESS: "success",
  ERROR: "error",
} as const

export type NotificationSendStatus =
  (typeof NOTIFICATION_SEND_STATUS)[keyof typeof NOTIFICATION_SEND_STATUS]

export interface InsertUserNotificationInput {
  userId: string
  notificationType: string
  notificationService: string
  notificationMetadata?: Record<string, unknown> | null
  notificationSendStatus: NotificationSendStatus
  createdBy?: string | null
}

export interface InsertedUserNotification {
  id: string
}

const CREATED_BY = "worker-notification"

/**
 * Writes rows into `user_notifications` (shared Neon schema, owned by the
 * SkyDIIV web app via Prisma). Uses the direct (unpooled) endpoint since this
 * is a write.
 *
 * Notes on the raw INSERT:
 *   - `notification_send_status` is a PostgreSQL enum created by Prisma
 *     (`"UserNotificationSendStatus"`), so the bound text param is cast to it.
 *   - `notification_metadata` is JSONB — serialised via `sql.json(...)`.
 *   - `updated_at` has no DB default (Prisma manages it with `@updatedAt`),
 *     so it must be set explicitly here.
 */
export class SqlUserNotificationsRepository {
  constructor(private readonly writeDb: postgres.Sql) {}

  async insert(input: InsertUserNotificationInput): Promise<InsertedUserNotification> {
    const metadata =
      input.notificationMetadata == null
        ? null
        : this.writeDb.json(input.notificationMetadata as postgres.JSONValue)
    const createdBy = input.createdBy ?? CREATED_BY

    const rows = await this.writeDb<InsertedUserNotification[]>`
      INSERT INTO user_notifications (
        user_id,
        notification_type,
        notification_service,
        notification_metadata,
        notification_send_status,
        created_by,
        updated_at
      ) VALUES (
        ${input.userId},
        ${input.notificationType},
        ${input.notificationService},
        ${metadata},
        ${input.notificationSendStatus}::"UserNotificationSendStatus",
        ${createdBy},
        now()
      )
      RETURNING id
    `

    return rows[0]
  }
}
