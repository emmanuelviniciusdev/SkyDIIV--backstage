import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  loadEvent: vi.fn(),
  dispatchEvent: vi.fn(),
  markSuccess: vi.fn(),
  markError: vi.fn(),
  releaseLock: vi.fn(),
  resetDbClient: vi.fn(),
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
  resetDbClient: mocks.resetDbClient,
}))

vi.mock("../../src/workflows/process-outbox-event/steps/acquire-lock", () => ({
  acquireOutboxProcessingLockStep: mocks.acquireLock,
}))

vi.mock("../../src/workflows/process-outbox-event/steps/load-event", () => ({
  loadOutboxEventStep: mocks.loadEvent,
}))

vi.mock("../../src/workflows/process-outbox-event/steps/dispatch-event", () => ({
  dispatchOutboxEventStep: mocks.dispatchEvent,
}))

vi.mock("../../src/workflows/process-outbox-event/steps/mark-success", () => ({
  markOutboxEventSuccessStep: mocks.markSuccess,
}))

vi.mock("../../src/workflows/process-outbox-event/steps/mark-error", () => ({
  markOutboxEventErrorStep: mocks.markError,
}))

vi.mock("../../src/workflows/process-outbox-event/steps/release-lock", () => ({
  releaseOutboxProcessingLockStep: mocks.releaseLock,
}))

import "../../src/workflows/process-outbox-event/workflow"

const mockEvent = {
  id: "evt-uuid-1",
  flow: "sync-language",
  event: "language-changed",
  payload: { userId: "user-1" },
  status: "PENDING" as const,
  created_at: new Date(),
  created_by: null,
  updated_at: new Date(),
  updated_by: null,
}

function runWorkflow(payload: unknown) {
  if (!mocks.workflowHandler) {
    throw new Error("Workflow handler was not registered")
  }
  return mocks.workflowHandler({
    requestPayload: payload,
    run: mocks.run,
  })
}

describe("processOutboxEventWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockImplementation(async (_name: string, fn: () => unknown) => fn())
    mocks.acquireLock.mockResolvedValue(true)
    mocks.loadEvent.mockResolvedValue({ kind: "ready", event: mockEvent })
    mocks.dispatchEvent.mockResolvedValue({ ok: true })
    mocks.markSuccess.mockResolvedValue(undefined)
    mocks.markError.mockResolvedValue(undefined)
    mocks.releaseLock.mockResolvedValue(undefined)
  })

  it("throws when payload is invalid", async () => {
    await expect(runWorkflow({})).rejects.toThrow(
      "Workflow payload must include a non-empty outboxEventId",
    )
  })

  it("returns already-processing when the lock is not acquired", async () => {
    mocks.acquireLock.mockResolvedValueOnce(false)

    await expect(runWorkflow({ outboxEventId: "evt-uuid-1" })).resolves.toEqual({
      processed: false,
      reason: "already-processing",
      outboxEventId: "evt-uuid-1",
    })

    expect(mocks.loadEvent).not.toHaveBeenCalled()
  })

  it("releases the lock and returns not-found when the event is missing", async () => {
    mocks.loadEvent.mockResolvedValueOnce({ kind: "skip", reason: "not-found" })

    await expect(runWorkflow({ outboxEventId: "evt-uuid-1" })).resolves.toEqual({
      processed: false,
      reason: "not-found",
      outboxEventId: "evt-uuid-1",
    })

    expect(mocks.releaseLock).toHaveBeenCalledWith("evt-uuid-1")
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  it("releases the lock and returns already-processed for terminal statuses", async () => {
    mocks.loadEvent.mockResolvedValueOnce({
      kind: "skip",
      reason: "already-processed",
      status: "SUCCESS",
    })

    await expect(runWorkflow({ outboxEventId: "evt-uuid-1" })).resolves.toEqual({
      processed: false,
      reason: "already-processed",
      outboxEventId: "evt-uuid-1",
      status: "SUCCESS",
    })

    expect(mocks.releaseLock).toHaveBeenCalledWith("evt-uuid-1")
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  it("runs dispatch, mark-success, and release-lock as separate durable steps on success", async () => {
    await expect(runWorkflow({ outboxEventId: "evt-uuid-1" })).resolves.toEqual({
      processed: true,
      outboxEventId: "evt-uuid-1",
      flow: "sync-language",
      event: "language-changed",
    })

    expect(mocks.run).toHaveBeenCalledWith("dispatch-event", expect.any(Function))
    expect(mocks.run).toHaveBeenCalledWith("mark-success", expect.any(Function))
    expect(mocks.run).toHaveBeenCalledWith("release-lock", expect.any(Function))
    expect(mocks.dispatchEvent).toHaveBeenCalledWith(mockEvent)
    expect(mocks.markSuccess).toHaveBeenCalledWith("evt-uuid-1")
    expect(mocks.markError).not.toHaveBeenCalled()
    expect(mocks.releaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  it("runs mark-error and release-lock as separate steps when dispatch fails", async () => {
    mocks.dispatchEvent.mockResolvedValueOnce({ ok: false, error: "QStash publish error" })

    await expect(runWorkflow({ outboxEventId: "evt-uuid-1" })).rejects.toThrow(
      "Failed to dispatch outbox event: QStash publish error",
    )

    expect(mocks.run).toHaveBeenCalledWith("mark-error", expect.any(Function))
    expect(mocks.run).toHaveBeenCalledWith("release-lock", expect.any(Function))
    expect(mocks.markError).toHaveBeenCalledWith("evt-uuid-1")
    expect(mocks.markSuccess).not.toHaveBeenCalled()
    expect(mocks.releaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  it("does not release the lock before mark-success completes", async () => {
    const callOrder: string[] = []
    mocks.markSuccess.mockImplementation(async () => {
      callOrder.push("mark-success")
    })
    mocks.releaseLock.mockImplementation(async () => {
      callOrder.push("release-lock")
    })

    await runWorkflow({ outboxEventId: "evt-uuid-1" })

    expect(callOrder).toEqual(["mark-success", "release-lock"])
  })
})
