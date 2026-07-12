import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the catch-up-outbox-events flow's run() orchestration.
 * Mocks the DB, repository, and dispatcher; dispatch batching itself is
 * covered separately in catch-up-dispatch.test.ts.
 */

const { mockFindStalePending, mockBatchJSON } = vi.hoisted(() => ({
  mockFindStalePending: vi.fn(),
  mockBatchJSON: vi.fn(),
}))

vi.mock("../../src/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
  resetDbClient: vi.fn(),
}))

vi.mock("../../src/lib/db/outbox-events.repository", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SqlOutboxEventsRepository: vi.fn(function (this: any) {
    this.findStalePendingEvents = mockFindStalePending
  }),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashClient: vi.fn(() => ({ batchJSON: mockBatchJSON })),
}))

import { catchUpOutboxEventsFlow } from "../../src/flows/catch-up-outbox-events.flow"

describe("catchUpOutboxEventsFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.workers.dev"
    delete process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES
  })

  it("is named catch-up-outbox-events", () => {
    expect(catchUpOutboxEventsFlow.name).toBe("catch-up-outbox-events")
  })

  it("returns dispatched: 0 and does not dispatch when no stale events", async () => {
    mockFindStalePending.mockResolvedValueOnce({ minAgeMinutes: 10, events: [] })

    const result = await catchUpOutboxEventsFlow.run()

    expect(result).toEqual({ flow: "catch-up-outbox-events", dispatched: 0 })
    expect(mockBatchJSON).not.toHaveBeenCalled()
    expect(mockFindStalePending).toHaveBeenCalledOnce()
  })

  it("dispatches stale events and reports the count", async () => {
    mockFindStalePending.mockResolvedValueOnce({
      minAgeMinutes: 10,
      events: [{ outboxEventId: "evt-1" }, { outboxEventId: "evt-2" }],
    })
    mockBatchJSON.mockResolvedValueOnce([])

    const result = await catchUpOutboxEventsFlow.run()

    expect(result).toEqual({ flow: "catch-up-outbox-events", dispatched: 2 })
    expect(mockBatchJSON).toHaveBeenCalledOnce()
  })

  it("propagates errors from the stale events query", async () => {
    mockFindStalePending.mockRejectedValueOnce(new Error("DB connection failed"))

    await expect(catchUpOutboxEventsFlow.run()).rejects.toThrow("DB connection failed")
  })
})
