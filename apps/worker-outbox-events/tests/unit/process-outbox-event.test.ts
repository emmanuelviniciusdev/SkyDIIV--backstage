import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the process-outbox-event handler.
 * Mocks the QStash receiver, DB client, repository, dispatcher, and cache helpers
 * to test orchestration logic: signature verification, payload parsing, processing
 * lock, dispatch, and deletion.
 */

const {
  mockVerify,
  mockFindById,
  mockDeleteById,
  mockDispatch,
  mockIsBeingProcessed,
  mockAcquireLock,
  mockReleaseLock,
} = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindById: vi.fn(),
  mockDeleteById: vi.fn(),
  mockDispatch: vi.fn(),
  mockIsBeingProcessed: vi.fn(),
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashReceiver: vi.fn(() => ({ verify: mockVerify })),
}))

vi.mock("../../src/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock("../../src/lib/db/outbox-events.repository", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SqlOutboxEventsRepository: vi.fn(function (this: any) {
    this.findById = mockFindById
    this.deleteById = mockDeleteById
  }),
}))

vi.mock("../../src/lib/dispatcher", () => ({
  dispatch: mockDispatch,
}))

vi.mock("../../src/lib/cache/outbox-processing-cache", () => ({
  isOutboxEventBeingProcessed: mockIsBeingProcessed,
  acquireOutboxProcessingLock: mockAcquireLock,
  releaseOutboxProcessingLock: mockReleaseLock,
}))

import { handleProcessOutboxEvent } from "../../src/handlers/process-outbox-event"

const BASE_URL = "https://worker-outbox-events.workers.dev"

function makeRequest(
  signature: string | null,
  body: unknown = { outboxEventId: "evt-uuid-1" },
): Request {
  const bodyStr = JSON.stringify(body)
  const headers = new Headers({ "Content-Type": "application/json" })
  if (signature) headers.set("upstash-signature", signature)
  return new Request(`${BASE_URL}/process-outbox-event`, {
    method: "POST",
    headers,
    body: bodyStr,
  })
}

const mockEvent = {
  id: "evt-uuid-1",
  flow: "sync-language",
  event: "language-changed",
  payload: { userId: "user-1", oldLocale: "en", newLocale: "pt" },
  status: "PENDING",
  created_at: new Date(),
  created_by: null,
  updated_at: new Date(),
  updated_by: null,
}

describe("handleProcessOutboxEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAcquireLock.mockResolvedValue(undefined)
    mockReleaseLock.mockResolvedValue(undefined)
  })

  // ── Auth ───────────────────────────────────────────────────────────────────

  it("returns 401 when upstash-signature header is missing", async () => {
    const res = await handleProcessOutboxEvent(makeRequest(null))
    expect(res.status).toBe(401)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it("returns 401 when QStash signature verification throws", async () => {
    mockVerify.mockRejectedValueOnce(new Error("bad signature"))
    const res = await handleProcessOutboxEvent(makeRequest("bad-sig"))
    expect(res.status).toBe(401)
    expect(mockIsBeingProcessed).not.toHaveBeenCalled()
  })

  it("returns 401 when QStash verify returns false", async () => {
    mockVerify.mockResolvedValueOnce(false)
    const res = await handleProcessOutboxEvent(makeRequest("invalid-sig"))
    expect(res.status).toBe(401)
    expect(mockIsBeingProcessed).not.toHaveBeenCalled()
  })

  // ── Payload validation ─────────────────────────────────────────────────────

  it("returns 400 when body is not valid JSON", async () => {
    mockVerify.mockResolvedValueOnce(true)
    const headers = new Headers({
      "Content-Type": "application/json",
      "upstash-signature": "valid-sig",
    })
    const req = new Request(`${BASE_URL}/process-outbox-event`, {
      method: "POST",
      headers,
      body: "not-json",
    })
    const res = await handleProcessOutboxEvent(req)
    expect(res.status).toBe(400)
    expect(mockIsBeingProcessed).not.toHaveBeenCalled()
  })

  it("returns 400 when outboxEventId is missing from payload", async () => {
    mockVerify.mockResolvedValueOnce(true)
    const res = await handleProcessOutboxEvent(makeRequest("valid-sig", {}))
    expect(res.status).toBe(400)
    expect(mockIsBeingProcessed).not.toHaveBeenCalled()
  })

  it("returns 400 when outboxEventId is empty string", async () => {
    mockVerify.mockResolvedValueOnce(true)
    const res = await handleProcessOutboxEvent(makeRequest("valid-sig", { outboxEventId: "" }))
    expect(res.status).toBe(400)
    expect(mockIsBeingProcessed).not.toHaveBeenCalled()
  })

  // ── Processing lock (already-processing) ──────────────────────────────────

  it("returns 200 with processed:false when the event is already being processed", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(true)

    const res = await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(false)
    expect(body.reason).toBe("already-processing")
    expect(body.outboxEventId).toBe("evt-uuid-1")
    expect(mockAcquireLock).not.toHaveBeenCalled()
    expect(mockFindById).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("acquires the lock when the event is not already being processed", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockResolvedValueOnce(undefined)

    await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(mockAcquireLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  // ── Idempotency (event not found) ─────────────────────────────────────────

  it("returns 200 with processed:false when event is not found in DB", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(null)

    const res = await handleProcessOutboxEvent(makeRequest("valid-sig"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(false)
    expect(body.reason).toBe("not-found")
    expect(body.outboxEventId).toBe("evt-uuid-1")
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(mockDeleteById).not.toHaveBeenCalled()
  })

  it("releases the lock when the event is not found in DB", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(null)

    await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(mockReleaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  // ── Successful processing ──────────────────────────────────────────────────

  it("dispatches and deletes the event when found, returning processed:true", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockResolvedValueOnce(undefined)

    const res = await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(true)
    expect(body.outboxEventId).toBe("evt-uuid-1")
    expect(body.flow).toBe("sync-language")
    expect(body.event).toBe("language-changed")
  })

  it("fetches the event using the outboxEventId from the payload", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockResolvedValueOnce(undefined)

    await handleProcessOutboxEvent(makeRequest("valid-sig", { outboxEventId: "evt-uuid-1" }))

    expect(mockFindById).toHaveBeenCalledWith("evt-uuid-1")
  })

  it("passes the full event row to the dispatcher", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockResolvedValueOnce(undefined)

    await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(mockDispatch).toHaveBeenCalledWith(mockEvent)
  })

  it("deletes the event by its ID after dispatching", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockResolvedValueOnce(undefined)

    await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(mockDeleteById).toHaveBeenCalledWith("evt-uuid-1")
  })

  it("releases the lock after successful processing", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockResolvedValueOnce(undefined)

    await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(mockReleaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  // ── Dispatch failure ───────────────────────────────────────────────────────

  it("returns 500 and does not delete when dispatch fails", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockRejectedValueOnce(new Error("QStash publish error"))

    const res = await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(res.status).toBe(500)
    expect(mockDeleteById).not.toHaveBeenCalled()
  })

  it("releases the lock when dispatch fails so QStash retries can proceed", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockRejectedValueOnce(new Error("QStash publish error"))

    await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(mockReleaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })

  // ── Delete failure after successful dispatch ───────────────────────────────

  it("returns 200 and releases the lock even when delete fails after a successful dispatch", async () => {
    mockVerify.mockResolvedValueOnce(true)
    mockIsBeingProcessed.mockResolvedValueOnce(false)
    mockFindById.mockResolvedValueOnce(mockEvent)
    mockDispatch.mockResolvedValueOnce(undefined)
    mockDeleteById.mockRejectedValueOnce(new Error("DB connection lost"))

    const res = await handleProcessOutboxEvent(makeRequest("valid-sig"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.processed).toBe(true)
    expect(mockReleaseLock).toHaveBeenCalledWith("evt-uuid-1")
  })
})
