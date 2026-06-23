import { describe, it, expect } from "vitest"
import {
  resolveWorkflowBaseUrl,
  WORKFLOW_BASE_URL_ENV,
} from "../../src/lib/workflow-base-url"

describe("resolveWorkflowBaseUrl", () => {
  it("returns WORKER_AI_WORKFLOWS_URL", () => {
    expect(WORKFLOW_BASE_URL_ENV).toBe("WORKER_AI_WORKFLOWS_URL")
    expect(
      resolveWorkflowBaseUrl({
        WORKER_AI_WORKFLOWS_URL:
          "https://worker-ai-workflows.example.workers.dev",
      }),
    ).toBe("https://worker-ai-workflows.example.workers.dev")
  })
})
