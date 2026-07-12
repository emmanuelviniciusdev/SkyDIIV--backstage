import { describe, it, expect } from "vitest"
import { resolveProcessOutboxEventUrl } from "../../src/lib/worker-outbox-events-url"

describe("worker-outbox-events URL helpers", () => {
  it("resolveProcessOutboxEventUrl appends /process-outbox-event to WORKER_OUTBOX_EVENTS_URL", () => {
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.workers.dev"
    expect(resolveProcessOutboxEventUrl()).toBe(
      "https://worker-outbox-events.example.workers.dev/process-outbox-event",
    )
  })

  it("handles trailing slash on WORKER_OUTBOX_EVENTS_URL", () => {
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.workers.dev/"
    expect(resolveProcessOutboxEventUrl()).toBe(
      "https://worker-outbox-events.example.workers.dev/process-outbox-event",
    )
  })

  it("throws when WORKER_OUTBOX_EVENTS_URL is not configured", () => {
    delete process.env.WORKER_OUTBOX_EVENTS_URL
    expect(() => resolveProcessOutboxEventUrl()).toThrow(
      "WORKER_OUTBOX_EVENTS_URL environment variable is not set",
    )
  })
})
