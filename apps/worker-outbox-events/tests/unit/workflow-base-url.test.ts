import { describe, it, expect } from "vitest"
import { resolveWorkflowBaseUrl } from "../../src/lib/workflow-base-url"

describe("resolveWorkflowBaseUrl", () => {
  it("returns WORKER_OUTBOX_EVENTS_URL when set", () => {
    expect(
      resolveWorkflowBaseUrl({
        WORKER_OUTBOX_EVENTS_URL: "https://worker-outbox-events.example.workers.dev",
      }),
    ).toBe("https://worker-outbox-events.example.workers.dev")
  })

  it("trims whitespace from WORKER_OUTBOX_EVENTS_URL", () => {
    expect(
      resolveWorkflowBaseUrl({
        WORKER_OUTBOX_EVENTS_URL: "  https://worker-outbox-events.example.workers.dev  ",
      }),
    ).toBe("https://worker-outbox-events.example.workers.dev")
  })

  it("throws when WORKER_OUTBOX_EVENTS_URL is missing", () => {
    expect(() => resolveWorkflowBaseUrl({})).toThrow(
      "WORKER_OUTBOX_EVENTS_URL environment variable is not set",
    )
  })
})
