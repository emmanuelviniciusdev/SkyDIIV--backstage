import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  tryAcquireLock: vi.fn(),
  releaseLock: vi.fn(),
  findById: vi.fn(),
  updateStatus: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock("../../src/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock("../../src/lib/db/outbox-events.repository", () => ({
  SqlOutboxEventsRepository: vi.fn(function (this: { findById: typeof mocks.findById; updateStatus: typeof mocks.updateStatus }) {
    this.findById = mocks.findById
    this.updateStatus = mocks.updateStatus
  }),
}))

vi.mock("../../src/lib/dispatcher", () => ({
  dispatch: mocks.dispatch,
}))

vi.mock("../../src/lib/cache/outbox-processing-cache", () => ({
  tryAcquireOutboxProcessingLock: mocks.tryAcquireLock,
  releaseOutboxProcessingLock: mocks.releaseLock,
}))

import { acquireOutboxProcessingLockStep } from "../../src/workflows/process-outbox-event/steps/acquire-lock"
import { loadOutboxEventStep } from "../../src/workflows/process-outbox-event/steps/load-event"
import { dispatchOutboxEventStep } from "../../src/workflows/process-outbox-event/steps/dispatch-event"
import { markOutboxEventSuccessStep } from "../../src/workflows/process-outbox-event/steps/mark-success"
import { markOutboxEventErrorStep } from "../../src/workflows/process-outbox-event/steps/mark-error"
import { releaseOutboxProcessingLockStep } from "../../src/workflows/process-outbox-event/steps/release-lock"

const mockEvent = {
  id: "evt-uuid-1",
  event_id: "e78e3646-c18f-48d1-a63c-cebfc2c77730",
  event_name: "language-changed",
  broker_name: "QStash",
  payload: { userid: "user-1", old_language: "en", new_language: "pt" },
  status: "PENDING" as const,
  created_at: new Date(),
  created_by: null,
  updated_at: new Date(),
  updated_by: null,
}

describe("process-outbox-event steps", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("acquireOutboxProcessingLockStep delegates to the cache helper", async () => {
    mocks.tryAcquireLock.mockResolvedValueOnce(true)
    await expect(acquireOutboxProcessingLockStep("evt-uuid-1")).resolves.toBe(true)
    expect(mocks.tryAcquireLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  it("loadOutboxEventStep returns ready for PENDING rows", async () => {
    mocks.findById.mockResolvedValueOnce(mockEvent)
    await expect(loadOutboxEventStep("evt-uuid-1")).resolves.toEqual({
      kind: "ready",
      event: mockEvent,
    })
  })

  it("loadOutboxEventStep returns skip for missing rows", async () => {
    mocks.findById.mockResolvedValueOnce(null)
    await expect(loadOutboxEventStep("evt-uuid-1")).resolves.toEqual({
      kind: "skip",
      reason: "not-found",
    })
  })

  it("loadOutboxEventStep returns skip for terminal statuses", async () => {
    mocks.findById.mockResolvedValueOnce({ ...mockEvent, status: "ERROR" })
    await expect(loadOutboxEventStep("evt-uuid-1")).resolves.toEqual({
      kind: "skip",
      reason: "already-processed",
      status: "ERROR",
    })
  })

  it("dispatchOutboxEventStep returns ok:true on success", async () => {
    mocks.dispatch.mockResolvedValueOnce(undefined)
    await expect(dispatchOutboxEventStep(mockEvent)).resolves.toEqual({ ok: true })
    expect(mocks.dispatch).toHaveBeenCalledWith(mockEvent)
  })

  it("dispatchOutboxEventStep returns ok:false without throwing on failure", async () => {
    mocks.dispatch.mockRejectedValueOnce(new Error("publish failed"))
    await expect(dispatchOutboxEventStep(mockEvent)).resolves.toEqual({
      ok: false,
      error: "Error: publish failed",
    })
  })

  it("markOutboxEventSuccessStep updates status to SUCCESS", async () => {
    await markOutboxEventSuccessStep("evt-uuid-1")
    expect(mocks.updateStatus).toHaveBeenCalledWith("evt-uuid-1", "SUCCESS")
  })

  it("markOutboxEventErrorStep updates status to ERROR", async () => {
    await markOutboxEventErrorStep("evt-uuid-1")
    expect(mocks.updateStatus).toHaveBeenCalledWith("evt-uuid-1", "ERROR")
  })

  it("releaseOutboxProcessingLockStep delegates to the cache helper", async () => {
    await releaseOutboxProcessingLockStep("evt-uuid-1")
    expect(mocks.releaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })
})
