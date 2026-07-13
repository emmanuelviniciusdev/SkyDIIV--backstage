import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the outbox event dispatcher.
 * Mocks the QStash client and downstream URL resolvers to verify
 * correct routing per flow and error propagation on unknown flows.
 */

const { mockPublishJSON } = vi.hoisted(() => ({
  mockPublishJSON: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashClient: vi.fn(() => ({ publishJSON: mockPublishJSON })),
}))

import { dispatch, OUTBOX_FLOWS } from "../../src/lib/dispatcher"
import type { OutboxEventRow } from "../../src/lib/db/outbox-events.repository"

function makeEvent(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: "evt-uuid-1",
    flow: "sync-language",
    event: "language-changed",
    payload: { userId: "user-1", oldLocale: "en", newLocale: "pt" },
    status: "PENDING",
    created_at: new Date(),
    created_by: null,
    updated_at: new Date(),
    updated_by: null,
    ...overrides,
  }
}

describe("dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKER_SYNC_URL = "https://worker-sync.example.workers.dev"
    process.env.WORKER_AI_WORKFLOWS_URL = "https://worker-ai-workflows.example.workers.dev"
    process.env.WORKER_NOTIFICATION_URL = "https://worker-notification.example.workers.dev"
  })

  // ── sync-language ──────────────────────────────────────────────────────────

  it("publishes to worker-sync /sync/language for sync-language flow", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const event = makeEvent({ flow: OUTBOX_FLOWS.SYNC_LANGUAGE })

    await dispatch(event)

    expect(mockPublishJSON).toHaveBeenCalledOnce()
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://worker-sync.example.workers.dev/sync/language",
      body: event.payload,
    })
  })

  it("forwards the outbox event payload verbatim for sync-language", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const payload = { userId: "user-42", oldLocale: "en", newLocale: "es" }
    const event = makeEvent({ flow: OUTBOX_FLOWS.SYNC_LANGUAGE, payload })

    await dispatch(event)

    expect(mockPublishJSON.mock.calls[0]![0]).toMatchObject({ body: payload })
  })

  // ── generate-weekly-outfits ────────────────────────────────────────────────

  it("publishes to worker-ai-workflows /generate-weekly-outfits for generate-weekly-outfits flow", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const event = makeEvent({
      flow: OUTBOX_FLOWS.GENERATE_WEEKLY_OUTFITS,
      payload: { userId: "user-2" },
    })

    await dispatch(event)

    expect(mockPublishJSON).toHaveBeenCalledOnce()
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://worker-ai-workflows.example.workers.dev/generate-weekly-outfits",
      body: { userId: "user-2" },
    })
  })

  it("forwards the outbox event payload verbatim for generate-weekly-outfits", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const payload = { userId: "user-99" }
    const event = makeEvent({ flow: OUTBOX_FLOWS.GENERATE_WEEKLY_OUTFITS, payload })

    await dispatch(event)

    expect(mockPublishJSON.mock.calls[0]![0]).toMatchObject({ body: payload })
  })

  // ── email--welcome ─────────────────────────────────────────────────────────

  it("publishes to worker-notification /email--welcome for email--welcome flow", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const payload = {
      user_id: "user-3",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    }
    const event = makeEvent({ flow: OUTBOX_FLOWS.EMAIL_WELCOME, payload })

    await dispatch(event)

    expect(mockPublishJSON).toHaveBeenCalledOnce()
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://worker-notification.example.workers.dev/email--welcome",
      body: payload,
    })
  })

  it("throws when WORKER_NOTIFICATION_URL is not set", async () => {
    delete process.env.WORKER_NOTIFICATION_URL
    const event = makeEvent({ flow: OUTBOX_FLOWS.EMAIL_WELCOME })

    await expect(dispatch(event)).rejects.toThrow(
      "WORKER_NOTIFICATION_URL environment variable is not set",
    )
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  // ── Unknown flow ───────────────────────────────────────────────────────────

  it("throws for an unknown flow and does not call publishJSON", async () => {
    const event = makeEvent({ flow: "unsupported-flow" })

    await expect(dispatch(event)).rejects.toThrow("Unknown outbox flow: unsupported-flow")
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  // ── QStash publish failure ─────────────────────────────────────────────────

  it("propagates QStash publish errors", async () => {
    mockPublishJSON.mockRejectedValueOnce(new Error("QStash unavailable"))
    const event = makeEvent({ flow: OUTBOX_FLOWS.SYNC_LANGUAGE })

    await expect(dispatch(event)).rejects.toThrow("QStash unavailable")
  })

  // ── Missing env vars ───────────────────────────────────────────────────────

  it("throws when WORKER_SYNC_URL is not set", async () => {
    delete process.env.WORKER_SYNC_URL
    const event = makeEvent({ flow: OUTBOX_FLOWS.SYNC_LANGUAGE })

    await expect(dispatch(event)).rejects.toThrow("WORKER_SYNC_URL environment variable is not set")
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  it("throws when WORKER_AI_WORKFLOWS_URL is not set", async () => {
    delete process.env.WORKER_AI_WORKFLOWS_URL
    const event = makeEvent({ flow: OUTBOX_FLOWS.GENERATE_WEEKLY_OUTFITS })

    await expect(dispatch(event)).rejects.toThrow(
      "WORKER_AI_WORKFLOWS_URL environment variable is not set",
    )
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })
})
