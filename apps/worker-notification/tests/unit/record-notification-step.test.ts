import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockInsert, mockGetWriteDb } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockGetWriteDb: vi.fn(() => ({ __writeDb: true })),
}))

vi.mock("../../src/lib/db/client", () => ({
  getWriteDb: mockGetWriteDb,
}))

vi.mock("../../src/lib/db/user-notifications.repository", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/db/user-notifications.repository")
  >("../../src/lib/db/user-notifications.repository")
  return {
    ...actual,
    SqlUserNotificationsRepository: class {
      insert = mockInsert
    },
  }
})

import { recordNotificationStep } from "../../src/workflows/email--welcome/steps/record-notification"

describe("recordNotificationStep", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("inserts a success notification with message_id metadata", async () => {
    mockInsert.mockResolvedValue({ id: "notif-1" })

    const result = await recordNotificationStep({
      userId: "user-1",
      service: "resend",
      status: "success",
      metadata: { message_id: "msg-42", locale: "pt-BR" },
    })

    expect(result).toEqual({ notificationId: "notif-1" })
    expect(mockInsert).toHaveBeenCalledWith({
      userId: "user-1",
      notificationType: "welcome",
      notificationService: "resend",
      notificationMetadata: { message_id: "msg-42", locale: "pt-BR" },
      notificationSendStatus: "success",
    })
  })

  it("inserts an error notification with structured error metadata", async () => {
    mockInsert.mockResolvedValue({ id: "notif-2" })

    await recordNotificationStep({
      userId: "user-1",
      service: "resend",
      status: "error",
      metadata: {
        locale: "es-PE",
        error: {
          code: "provider_request_failed",
          message: "Resend request failed: 422",
          provider: "resend",
          status_code: 422,
          response_body: '{"message":"invalid from"}',
        },
      },
    })

    expect(mockInsert.mock.calls[0][0]).toMatchObject({
      notificationSendStatus: "error",
      notificationMetadata: {
        locale: "es-PE",
        error: {
          code: "provider_request_failed",
          message: "Resend request failed: 422",
          provider: "resend",
          status_code: 422,
          response_body: '{"message":"invalid from"}',
        },
      },
    })
  })

  it("propagates repository errors", async () => {
    mockInsert.mockRejectedValue(new Error("db down"))
    await expect(
      recordNotificationStep({
        userId: "user-1",
        service: "resend",
        status: "success",
        metadata: { message_id: "m", locale: "en-US" },
      }),
    ).rejects.toThrow("db down")
  })
})
