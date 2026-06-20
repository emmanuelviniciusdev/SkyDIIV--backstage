import { setRedisKey } from "./redis"

/** Must stay in sync with skydiiv web app */
export const NOTIFICATION_TYPES = {
  NEW_WEEKLY_OUTFITS: "new-weekly-outfits",
  NEW_WARDROBE_PANORAMA: "new-wardrobe-panorama",
} as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

export type NotificationPayload = {
  updatedAt: string
}

function buildNotificationKey(userId: string, type: NotificationType): string {
  return `notification--${type}--${userId}`
}

function buildNotificationPayload(): NotificationPayload {
  return { updatedAt: new Date().toISOString() }
}

/**
 * Sets the unread notification flag for the user in Redis.
 * Returns false when Redis is not configured.
 */
export async function setNotification(userId: string, type: NotificationType): Promise<boolean> {
  const key = buildNotificationKey(userId, type)
  const value = JSON.stringify(buildNotificationPayload())
  return setRedisKey(key, value)
}

export async function setNewWeeklyOutfitsNotification(userId: string): Promise<boolean> {
  return setNotification(userId, NOTIFICATION_TYPES.NEW_WEEKLY_OUTFITS)
}

export async function setNewWardrobePanoramaNotification(userId: string): Promise<boolean> {
  return setNotification(userId, NOTIFICATION_TYPES.NEW_WARDROBE_PANORAMA)
}
