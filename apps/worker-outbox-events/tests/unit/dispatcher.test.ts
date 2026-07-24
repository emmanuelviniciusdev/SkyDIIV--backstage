import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the outbox event dispatcher.
 * Mocks QStash and Cloudflare Queues publishers to verify routing by
 * (event_name, broker_name) and error propagation.
 */

const { mockPublishJSON, mockPublishToCloudflareQueue, mockResolveCfQueueId } = vi.hoisted(() => ({
  mockPublishJSON: vi.fn(),
  mockPublishToCloudflareQueue: vi.fn(),
  mockResolveCfQueueId: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashClient: vi.fn(() => ({ publishJSON: mockPublishJSON })),
}))

vi.mock("../../src/lib/cloudflare-queues", () => ({
  publishToCloudflareQueue: mockPublishToCloudflareQueue,
  resolveCfQueueId: mockResolveCfQueueId,
}))

import { dispatch, OUTBOX_ROUTES, BROKER_NAMES, outboxRouteKey } from "../../src/lib/dispatcher"
import type { OutboxEventRow } from "../../src/lib/db/outbox-events.repository"

function makeEvent(overrides: Partial<OutboxEventRow> = {}): OutboxEventRow {
  return {
    id: "evt-uuid-1",
    event_id: "e78e3646-c18f-48d1-a63c-cebfc2c77730",
    event_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
    broker_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.brokerName,
    payload: { userid: "user-1", old_language: "en", new_language: "pt" },
    status: "PENDING",
    created_at: new Date(),
    created_by: null,
    updated_at: new Date(),
    updated_by: null,
    ...overrides,
  }
}

describe("outboxRouteKey", () => {
  it("joins event_name and broker_name", () => {
    expect(outboxRouteKey("language-changed", "QStash")).toBe("language-changed::QStash")
  })
})

describe("dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKER_SYNC_URL = "https://worker-sync.example.workers.dev"
    process.env.WORKER_NOTIFICATION_URL = "https://worker-notification.example.workers.dev"
    mockResolveCfQueueId.mockReturnValue("queue-scrape-1")
  })

  // ── language-changed + QStash ──────────────────────────────────────────────

  it("publishes to worker-sync /sync/language for language-changed on QStash", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      broker_name: BROKER_NAMES.QSTASH,
    })

    await dispatch(event)

    expect(mockPublishJSON).toHaveBeenCalledOnce()
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://worker-sync.example.workers.dev/sync/language",
      body: event.payload,
    })
    expect(mockPublishToCloudflareQueue).not.toHaveBeenCalled()
  })

  it("forwards the outbox event payload verbatim for language-changed", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const payload = { userid: "user-42", old_language: "en", new_language: "es" }
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      broker_name: BROKER_NAMES.QSTASH,
      payload,
    })

    await dispatch(event)

    expect(mockPublishJSON.mock.calls[0]![0]).toMatchObject({ body: payload })
  })

  // ── user-account-created + QStash ──────────────────────────────────────────

  it("publishes to worker-notification /email--welcome for user-account-created on QStash", async () => {
    mockPublishJSON.mockResolvedValueOnce({})
    const payload = {
      user_id: "user-3",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    }
    const event = makeEvent({
      event_id: "5fddc99f-6345-4bce-9c25-d985f1191c7d",
      event_name: OUTBOX_ROUTES.USER_ACCOUNT_CREATED_QSTASH.eventName,
      broker_name: BROKER_NAMES.QSTASH,
      payload,
    })

    await dispatch(event)

    expect(mockPublishJSON).toHaveBeenCalledOnce()
    expect(mockPublishJSON).toHaveBeenCalledWith({
      url: "https://worker-notification.example.workers.dev/email--welcome",
      body: payload,
    })
  })

  it("throws when WORKER_NOTIFICATION_URL is not set", async () => {
    delete process.env.WORKER_NOTIFICATION_URL
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.USER_ACCOUNT_CREATED_QSTASH.eventName,
      broker_name: BROKER_NAMES.QSTASH,
    })

    await expect(dispatch(event)).rejects.toThrow(
      "WORKER_NOTIFICATION_URL environment variable is not set",
    )
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  // ── scrape-shopping-suggestions + CF Queues ────────────────────────────────

  it("publishes scrape-shopping-suggestions to CF_SCRAPE_SHOPP_SUGG_QUEUE_ID", async () => {
    mockPublishToCloudflareQueue.mockResolvedValueOnce(undefined)
    const payload = {
      marketplace: "enjoei",
      userId: "user-9",
      searchParams: [
        {
          searchTerm: "vestido floral",
          gender: "Female",
          topSize: "M",
          bottomSize: "40",
          footSize: "38",
          brand: null,
        },
      ],
    }
    const event = makeEvent({
      event_id: "22526aec-2fc1-4734-baf7-1dfe04e45c19",
      event_name: OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.eventName,
      broker_name: BROKER_NAMES.CF_QUEUES,
      payload,
    })

    await dispatch(event)

    expect(mockResolveCfQueueId).toHaveBeenCalledWith("CF_SCRAPE_SHOPP_SUGG_QUEUE_ID")
    expect(mockPublishToCloudflareQueue).toHaveBeenCalledOnce()
    expect(mockPublishToCloudflareQueue).toHaveBeenCalledWith(
      {
        event: "scrape-shopping-suggestions",
        payload,
      },
      "queue-scrape-1",
    )
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  it("throws when CF_SCRAPE_SHOPP_SUGG_QUEUE_ID is not set", async () => {
    mockResolveCfQueueId.mockImplementationOnce(() => {
      throw new Error("CF_SCRAPE_SHOPP_SUGG_QUEUE_ID environment variable is not set")
    })
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.eventName,
      broker_name: BROKER_NAMES.CF_QUEUES,
      payload: { marketplace: "enjoei", userId: "user-1", searchParams: [{ searchTerm: "x" }] },
    })

    await expect(dispatch(event)).rejects.toThrow(
      "CF_SCRAPE_SHOPP_SUGG_QUEUE_ID environment variable is not set",
    )
    expect(mockPublishToCloudflareQueue).not.toHaveBeenCalled()
  })

  it("propagates Cloudflare Queues publish errors", async () => {
    mockPublishToCloudflareQueue.mockRejectedValueOnce(new Error("CF Queues unavailable"))
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.eventName,
      broker_name: BROKER_NAMES.CF_QUEUES,
      payload: { marketplace: "enjoei", userId: "user-1", searchParams: [{ searchTerm: "x" }] },
    })

    await expect(dispatch(event)).rejects.toThrow("CF Queues unavailable")
  })

  it("does not treat scrape-shopping-suggestions on QStash as a known route", async () => {
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.eventName,
      broker_name: BROKER_NAMES.QSTASH,
    })

    await expect(dispatch(event)).rejects.toThrow(
      "Unknown outbox route: event_name=scrape-shopping-suggestions, broker_name=QStash",
    )
    expect(mockPublishToCloudflareQueue).not.toHaveBeenCalled()
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  // ── Unknown / mismatched routes ────────────────────────────────────────────

  it("throws for an unknown event_name and does not call publishJSON", async () => {
    const event = makeEvent({ event_name: "unsupported-event", broker_name: BROKER_NAMES.QSTASH })

    await expect(dispatch(event)).rejects.toThrow(
      "Unknown outbox route: event_name=unsupported-event, broker_name=QStash",
    )
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  it("throws when event_name is known but broker_name does not match", async () => {
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      broker_name: "Kafka",
    })

    await expect(dispatch(event)).rejects.toThrow(
      "Unknown outbox route: event_name=language-changed, broker_name=Kafka",
    )
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })

  // ── QStash publish failure ─────────────────────────────────────────────────

  it("propagates QStash publish errors", async () => {
    mockPublishJSON.mockRejectedValueOnce(new Error("QStash unavailable"))
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      broker_name: BROKER_NAMES.QSTASH,
    })

    await expect(dispatch(event)).rejects.toThrow("QStash unavailable")
  })

  // ── Missing env vars ───────────────────────────────────────────────────────

  it("throws when WORKER_SYNC_URL is not set", async () => {
    delete process.env.WORKER_SYNC_URL
    const event = makeEvent({
      event_name: OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      broker_name: BROKER_NAMES.QSTASH,
    })

    await expect(dispatch(event)).rejects.toThrow("WORKER_SYNC_URL environment variable is not set")
    expect(mockPublishJSON).not.toHaveBeenCalled()
  })
})
