import { describe, it, expect, beforeEach } from "vitest"
import {
  resolveWorkerSyncUrl,
  resolveWorkerAiWorkflowsUrl,
  resolveWorkerNotificationUrl,
} from "../../src/lib/downstream-urls"

/**
 * Unit tests for downstream URL resolvers.
 * Verifies correct base-URL composition and error behaviour when env vars are unset.
 */

describe("resolveWorkerSyncUrl", () => {
  beforeEach(() => {
    process.env.WORKER_SYNC_URL = "https://worker-sync.example.workers.dev"
  })

  it("returns the full URL by joining the base and path", () => {
    const url = resolveWorkerSyncUrl("/sync/language")
    expect(url).toBe("https://worker-sync.example.workers.dev/sync/language")
  })

  it("strips trailing slashes from the base before joining", () => {
    process.env.WORKER_SYNC_URL = "https://worker-sync.example.workers.dev/"
    const url = resolveWorkerSyncUrl("/sync/language")
    expect(url).toBe("https://worker-sync.example.workers.dev/sync/language")
  })

  it("throws when WORKER_SYNC_URL is not set", () => {
    delete process.env.WORKER_SYNC_URL
    expect(() => resolveWorkerSyncUrl("/sync/language")).toThrow(
      "WORKER_SYNC_URL environment variable is not set",
    )
  })

  it("throws when WORKER_SYNC_URL is an empty string", () => {
    process.env.WORKER_SYNC_URL = ""
    expect(() => resolveWorkerSyncUrl("/sync/language")).toThrow(
      "WORKER_SYNC_URL environment variable is not set",
    )
  })

  it("throws when WORKER_SYNC_URL is only whitespace", () => {
    process.env.WORKER_SYNC_URL = "   "
    expect(() => resolveWorkerSyncUrl("/sync/language")).toThrow(
      "WORKER_SYNC_URL environment variable is not set",
    )
  })
})

describe("resolveWorkerAiWorkflowsUrl", () => {
  beforeEach(() => {
    process.env.WORKER_AI_WORKFLOWS_URL = "https://worker-ai-workflows.example.workers.dev"
  })

  it("returns the full URL by joining the base and path", () => {
    const url = resolveWorkerAiWorkflowsUrl("/generate-weekly-outfits")
    expect(url).toBe("https://worker-ai-workflows.example.workers.dev/generate-weekly-outfits")
  })

  it("throws when WORKER_AI_WORKFLOWS_URL is not set", () => {
    delete process.env.WORKER_AI_WORKFLOWS_URL
    expect(() => resolveWorkerAiWorkflowsUrl("/generate-weekly-outfits")).toThrow(
      "WORKER_AI_WORKFLOWS_URL environment variable is not set",
    )
  })
})

describe("resolveWorkerNotificationUrl", () => {
  beforeEach(() => {
    process.env.WORKER_NOTIFICATION_URL = "https://worker-notification.example.workers.dev"
  })

  it("returns the full URL by joining the base and path", () => {
    const url = resolveWorkerNotificationUrl("/email--welcome")
    expect(url).toBe("https://worker-notification.example.workers.dev/email--welcome")
  })

  it("throws when WORKER_NOTIFICATION_URL is not set", () => {
    delete process.env.WORKER_NOTIFICATION_URL
    expect(() => resolveWorkerNotificationUrl("/email--welcome")).toThrow(
      "WORKER_NOTIFICATION_URL environment variable is not set",
    )
  })
})
