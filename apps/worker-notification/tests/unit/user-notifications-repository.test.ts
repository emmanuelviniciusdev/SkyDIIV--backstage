import { describe, it, expect, vi } from "vitest"
import {
  SqlUserNotificationsRepository,
  NOTIFICATION_SEND_STATUS,
} from "../../src/lib/db/user-notifications.repository"
import type postgres from "postgres"

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
    return []
  })
}

/** Builds a postgres.js-like tagged-template mock that also exposes `.json`. */
function makeWriteDb(returnRows: unknown[]) {
  const jsonMarker = { __json: true }
  const tag = vi.fn().mockResolvedValue(returnRows) as unknown as postgres.Sql & {
    json: ReturnType<typeof vi.fn>
  }
  ;(tag as unknown as { json: ReturnType<typeof vi.fn> }).json = vi
    .fn()
    .mockReturnValue(jsonMarker)
  return { tag, jsonMarker }
}

describe("SqlUserNotificationsRepository", () => {
  it("inserts into user_notifications and returns the new id", async () => {
    const { tag } = makeWriteDb([{ id: "notif-1" }])
    const repo = new SqlUserNotificationsRepository(tag)

    const result = await repo.insert({
      userId: "user-1",
      notificationType: "welcome",
      notificationService: "resend",
      notificationMetadata: { message_id: "msg-1" },
      notificationSendStatus: NOTIFICATION_SEND_STATUS.SUCCESS,
    })

    expect(result).toEqual({ id: "notif-1" })
    const sql = getSqlStrings(tag as unknown as ReturnType<typeof vi.fn>).join(" ")
    expect(sql).toContain("INSERT INTO user_notifications")
    expect(sql).toContain('::"UserNotificationSendStatus"')
    expect(sql).toContain("RETURNING id")
  })

  it("serialises metadata via sql.json", async () => {
    const { tag, jsonMarker } = makeWriteDb([{ id: "notif-2" }])
    const repo = new SqlUserNotificationsRepository(tag)

    await repo.insert({
      userId: "user-1",
      notificationType: "welcome",
      notificationService: "resend",
      notificationMetadata: { message_id: "msg-2" },
      notificationSendStatus: "success",
    })

    const jsonMock = (tag as unknown as { json: ReturnType<typeof vi.fn> }).json
    expect(jsonMock).toHaveBeenCalledWith({ message_id: "msg-2" })
    // the json marker is passed as a bound parameter to the tagged template
    const params = (tag as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!.slice(1)
    expect(params).toContain(jsonMarker)
  })

  it("passes null metadata straight through (no sql.json call)", async () => {
    const { tag } = makeWriteDb([{ id: "notif-3" }])
    const repo = new SqlUserNotificationsRepository(tag)

    await repo.insert({
      userId: "user-1",
      notificationType: "welcome",
      notificationService: "resend",
      notificationMetadata: null,
      notificationSendStatus: "error",
    })

    const jsonMock = (tag as unknown as { json: ReturnType<typeof vi.fn> }).json
    expect(jsonMock).not.toHaveBeenCalled()
  })
})
