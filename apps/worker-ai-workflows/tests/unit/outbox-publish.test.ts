import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockBatchJSON } = vi.hoisted(() => ({
  mockBatchJSON: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashClient: vi.fn(() => ({ batchJSON: mockBatchJSON })),
}))

import {
  batchPublishOutboxMessages,
  resolveProcessOutboxEventUrl,
} from "../../src/lib/outbox/publish"

describe("resolveProcessOutboxEventUrl()", () => {
  afterEach(() => {
    delete process.env.WORKER_OUTBOX_EVENTS_URL
  })

  it("appends /process-outbox-event to the worker origin", () => {
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.workers.dev"
    expect(resolveProcessOutboxEventUrl()).toBe(
      "https://worker-outbox-events.example.workers.dev/process-outbox-event",
    )
  })

  it("throws when WORKER_OUTBOX_EVENTS_URL is missing", () => {
    expect(() => resolveProcessOutboxEventUrl()).toThrow(
      "WORKER_OUTBOX_EVENTS_URL environment variable is not set",
    )
  })
})

describe("batchPublishOutboxMessages()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.workers.dev"
  })

  afterEach(() => {
    delete process.env.WORKER_OUTBOX_EVENTS_URL
  })

  it("no-ops for an empty id list", async () => {
    await batchPublishOutboxMessages([])
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("publishes via QStash batchJSON", async () => {
    mockBatchJSON.mockResolvedValueOnce([])
    await batchPublishOutboxMessages(["evt-1", "evt-2"])

    expect(mockBatchJSON).toHaveBeenCalledOnce()
    expect(mockBatchJSON).toHaveBeenCalledWith([
      {
        url: "https://worker-outbox-events.example.workers.dev/process-outbox-event",
        body: { outboxEventId: "evt-1" },
      },
      {
        url: "https://worker-outbox-events.example.workers.dev/process-outbox-event",
        body: { outboxEventId: "evt-2" },
      },
    ])
  })
})
