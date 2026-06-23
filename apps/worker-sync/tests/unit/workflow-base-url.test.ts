import { describe, it, expect } from "vitest"
import {
  resolveWorkflowBaseUrl,
  WORKFLOW_BASE_URL_ENV,
} from "../../src/lib/workflow-base-url"

describe("resolveWorkflowBaseUrl", () => {
  it("returns WORKER_SYNC_URL", () => {
    expect(WORKFLOW_BASE_URL_ENV).toBe("WORKER_SYNC_URL")
    expect(
      resolveWorkflowBaseUrl({
        WORKER_SYNC_URL: "https://worker-sync.example.workers.dev",
      }),
    ).toBe("https://worker-sync.example.workers.dev")
  })

  it("throws when the worker-specific env is missing", () => {
    expect(() => resolveWorkflowBaseUrl({})).toThrow(
      "WORKER_SYNC_URL environment variable is not set",
    )
  })
})
