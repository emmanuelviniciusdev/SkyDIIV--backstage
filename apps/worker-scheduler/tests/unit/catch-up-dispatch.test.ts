import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { StaleOutboxEvent } from "../../src/lib/db/outbox-events.repository"

/**
 * Unit tests for dispatchStaleOutboxEvents.
 * Mocks @upstash/qstash Client to verify batching logic without network calls.
 */

const mockBatchJSON = vi.hoisted(() => vi.fn())

vi.mock("@upstash/qstash", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Client: vi.fn(function (this: any) { this.batchJSON = mockBatchJSON }),
  Receiver: vi.fn(function () {}),
}))

import { dispatchStaleOutboxEvents } from "../../src/flows/catch-up-outbox-events.flow"
import { resetQStashClients } from "../../src/lib/qstash"

describe("dispatchStaleOutboxEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQStashClients()
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.com"
    process.env.QSTASH_TOKEN = "test-token"
  })

  afterEach(() => {
    delete process.env.WORKER_OUTBOX_EVENTS_URL
    delete process.env.QSTASH_TOKEN
  })

  it("returns 0 and does not call QStash for empty input", async () => {
    const result = await dispatchStaleOutboxEvents([])
    expect(result).toBe(0)
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("dispatches a single batch for a small event list", async () => {
    mockBatchJSON.mockResolvedValue([])
    const events: StaleOutboxEvent[] = [
      { outboxEventId: "evt-1" },
      { outboxEventId: "evt-2" },
    ]

    const result = await dispatchStaleOutboxEvents(events)

    expect(result).toBe(2)
    expect(mockBatchJSON).toHaveBeenCalledTimes(1)

    const [messages] = mockBatchJSON.mock.calls[0] as [
      Array<{ url: string; body: { outboxEventId: string } }>,
    ]
    expect(messages).toHaveLength(2)
    expect(messages[0]!.body).toEqual({ outboxEventId: "evt-1" })
    expect(messages[0]!.url).toBe("https://worker-outbox-events.example.com/process-outbox-event")
  })

  it("throws when WORKER_OUTBOX_EVENTS_URL is not set", async () => {
    delete process.env.WORKER_OUTBOX_EVENTS_URL
    const events: StaleOutboxEvent[] = [{ outboxEventId: "evt-1" }]

    await expect(dispatchStaleOutboxEvents(events)).rejects.toThrow("WORKER_OUTBOX_EVENTS_URL")
  })

  it("sends correct Content-Type header for each message", async () => {
    mockBatchJSON.mockResolvedValue([])
    const events: StaleOutboxEvent[] = [{ outboxEventId: "evt-uuid-1" }]

    await dispatchStaleOutboxEvents(events)

    const [messages] = mockBatchJSON.mock.calls[0] as [Array<{ headers: Record<string, string> }>]
    expect(messages[0]!.headers["Content-Type"]).toBe("application/json")
  })
})
