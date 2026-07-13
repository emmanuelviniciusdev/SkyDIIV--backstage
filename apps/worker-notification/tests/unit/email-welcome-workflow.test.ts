import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  renderEmail: vi.fn(),
  sendEmail: vi.fn(),
  recordNotification: vi.fn(),
  resetDbClients: vi.fn(),
  workflowHandler: null as WorkflowHandler | null,
  run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
}))

type WorkflowHandler = (context: {
  requestPayload: unknown
  run: typeof mocks.run
}) => Promise<unknown>

vi.mock("@upstash/workflow/cloudflare", () => ({
  createWorkflow: vi.fn((handler: WorkflowHandler) => {
    mocks.workflowHandler = handler
    return { __workflow: true }
  }),
}))

vi.mock("../../src/lib/db/client", () => ({
  resetDbClients: mocks.resetDbClients,
}))

vi.mock("../../src/workflows/email--welcome/steps/render-email", () => ({
  renderEmailStep: mocks.renderEmail,
}))

vi.mock("../../src/workflows/email--welcome/steps/send-email", () => ({
  sendEmailStep: mocks.sendEmail,
}))

vi.mock("../../src/workflows/email--welcome/steps/record-notification", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/workflows/email--welcome/steps/record-notification")
  >("../../src/workflows/email--welcome/steps/record-notification")
  return {
    ...actual,
    recordNotificationStep: mocks.recordNotification,
  }
})

import "../../src/workflows/email--welcome/workflow"

const validPayload = {
  user_id: "user-1",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
}

const renderedEmail = {
  locale: "en-US" as const,
  to: "jane@example.com",
  from: "SkyDIIV <no-reply@skydiiv.space>",
  subject: "you're in — SkyDIIV",
  html: "<p>oi</p>",
  text: "oi",
  attachments: [],
}

function runWorkflow(payload: unknown) {
  if (!mocks.workflowHandler) throw new Error("Workflow handler was not registered")
  return mocks.workflowHandler({ requestPayload: payload, run: mocks.run })
}

describe("emailWelcomeWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockImplementation(async (_name: string, fn: () => unknown) => fn())
    mocks.renderEmail.mockReturnValue(renderedEmail)
    mocks.sendEmail.mockResolvedValue({ ok: true, provider: "resend", messageId: "msg-42" })
    mocks.recordNotification.mockResolvedValue({ notificationId: "notif-1" })
  })

  it("throws when the payload is invalid", async () => {
    await expect(runWorkflow({ user_id: "user-1", email: "nope" })).rejects.toThrow(
      "Workflow payload must include user_id and a valid email",
    )
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it("runs render, send and record as separate durable steps", async () => {
    await runWorkflow(validPayload)

    expect(mocks.resetDbClients).toHaveBeenCalledOnce()
    expect(mocks.run).toHaveBeenCalledWith("render-email", expect.any(Function))
    expect(mocks.run).toHaveBeenCalledWith("send-email", expect.any(Function))
    expect(mocks.run).toHaveBeenCalledWith("record-notification", expect.any(Function))

    expect(mocks.renderEmail).toHaveBeenCalledWith(validPayload)
    expect(mocks.sendEmail).toHaveBeenCalledWith("user-1", renderedEmail)
    expect(mocks.recordNotification).toHaveBeenCalledWith({
      userId: "user-1",
      service: "resend",
      status: "success",
      metadata: { message_id: "msg-42", locale: "en-US" },
    })
  })

  it("records the notification only after the email is sent", async () => {
    const order: string[] = []
    mocks.sendEmail.mockImplementation(async () => {
      order.push("send")
      return { ok: true, provider: "resend", messageId: "msg-1" }
    })
    mocks.recordNotification.mockImplementation(async () => {
      order.push("record")
      return { notificationId: "notif-1" }
    })

    await runWorkflow(validPayload)

    expect(order).toEqual(["send", "record"])
  })

  it("records an error notification and then throws when sending fails", async () => {
    mocks.sendEmail.mockResolvedValueOnce({
      ok: false,
      provider: "resend",
      error: {
        code: "provider_request_failed",
        message: "Resend request failed: 500 — upstream error",
        provider: "resend",
        status_code: 500,
        response_body: "upstream error",
      },
    })

    await expect(runWorkflow(validPayload)).rejects.toThrow(
      "Failed to send welcome email: Resend request failed: 500 — upstream error",
    )

    expect(mocks.recordNotification).toHaveBeenCalledWith({
      userId: "user-1",
      service: "resend",
      status: "error",
      metadata: {
        error: {
          code: "provider_request_failed",
          message: "Resend request failed: 500 — upstream error",
          provider: "resend",
          status_code: 500,
          response_body: "upstream error",
        },
        locale: "en-US",
      },
    })
  })
})
