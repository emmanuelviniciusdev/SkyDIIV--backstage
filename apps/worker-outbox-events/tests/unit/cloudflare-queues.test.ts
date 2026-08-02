import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  publishBatchToCloudflareQueue,
  publishToCloudflareQueue,
  resolveCfQueueId,
} from "../../src/lib/cloudflare-queues"

describe("resolveCfQueueId", () => {
  afterEach(() => {
    delete process.env.CF_SCRAPE_SHOPP_SUGG_QUEUE_ID
  })

  it("returns the trimmed queue ID from the given env var", () => {
    process.env.CF_SCRAPE_SHOPP_SUGG_QUEUE_ID = "  queue-1  "
    expect(resolveCfQueueId("CF_SCRAPE_SHOPP_SUGG_QUEUE_ID")).toBe("queue-1")
  })

  it("throws when the env var is missing", () => {
    expect(() => resolveCfQueueId("CF_SCRAPE_SHOPP_SUGG_QUEUE_ID")).toThrow(
      "CF_SCRAPE_SHOPP_SUGG_QUEUE_ID environment variable is not set",
    )
  })
})

describe("publishBatchToCloudflareQueue", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CF_ACCOUNT_ID = "acc-1"
    process.env.CF_QUEUES_API_TOKEN = "token-1"
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.CF_ACCOUNT_ID
    delete process.env.CF_QUEUES_API_TOKEN
  })

  it("POSTs a batch of event envelopes to the Cloudflare Queues batch API", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ success: true }),
    })
    globalThis.fetch = fetchMock

    const messages = [
      {
        event: "scrape-shopping-suggestions",
        payload: { marketplace: "enjoei", userId: "user-1", searchParams: [] },
      },
      {
        event: "scrape-shopping-suggestions",
        payload: { marketplace: "enjoei", userId: "user-2", searchParams: [] },
      },
    ]

    await publishBatchToCloudflareQueue(messages, "queue-1")

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc-1/queues/queue-1/messages/batch",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages.map((body) => ({
            body,
            content_type: "json",
          })),
        }),
      },
    )
  })

  it("throws when the message list is empty", async () => {
    await expect(publishBatchToCloudflareQueue([], "queue-1")).rejects.toThrow(
      "Cloudflare Queues batch publish requires at least one message",
    )
  })

  it("throws when queueId is empty", async () => {
    await expect(
      publishBatchToCloudflareQueue(
        [{ event: "scrape-shopping-suggestions", payload: {} }],
        "  ",
      ),
    ).rejects.toThrow("Cloudflare queue ID must be a non-empty string")
  })

  it("throws when CF_ACCOUNT_ID is missing", async () => {
    delete process.env.CF_ACCOUNT_ID
    await expect(
      publishBatchToCloudflareQueue(
        [{ event: "scrape-shopping-suggestions", payload: {} }],
        "queue-1",
      ),
    ).rejects.toThrow("CF_ACCOUNT_ID environment variable is not set")
  })

  it("throws when CF_QUEUES_API_TOKEN is missing", async () => {
    delete process.env.CF_QUEUES_API_TOKEN
    await expect(
      publishBatchToCloudflareQueue(
        [{ event: "scrape-shopping-suggestions", payload: {} }],
        "queue-1",
      ),
    ).rejects.toThrow("CF_QUEUES_API_TOKEN environment variable is not set")
  })

  it("throws when the API returns a non-OK response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () =>
        JSON.stringify({
          success: false,
          errors: [{ message: "Authentication error" }],
        }),
    })

    await expect(
      publishBatchToCloudflareQueue(
        [{ event: "scrape-shopping-suggestions", payload: {} }],
        "queue-1",
      ),
    ).rejects.toThrow("Cloudflare Queues batch publish failed (403): Authentication error")
  })

  it("throws when the API returns success:false with 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          success: false,
          errors: [{ message: "Queue not found" }],
        }),
    })

    await expect(
      publishBatchToCloudflareQueue(
        [{ event: "scrape-shopping-suggestions", payload: {} }],
        "queue-1",
      ),
    ).rejects.toThrow("Cloudflare Queues batch publish failed (200): Queue not found")
  })
})

describe("publishToCloudflareQueue", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CF_ACCOUNT_ID = "acc-1"
    process.env.CF_QUEUES_API_TOKEN = "token-1"
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.CF_ACCOUNT_ID
    delete process.env.CF_QUEUES_API_TOKEN
  })

  it("delegates to the batch API with a single-message array", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ success: true }),
    })
    globalThis.fetch = fetchMock

    await publishToCloudflareQueue(
      {
        event: "scrape-shopping-suggestions",
        payload: { marketplace: "enjoei", userId: "user-1", searchParams: [] },
      },
      "queue-1",
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc-1/queues/queue-1/messages/batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              body: {
                event: "scrape-shopping-suggestions",
                payload: { marketplace: "enjoei", userId: "user-1", searchParams: [] },
              },
              content_type: "json",
            },
          ],
        }),
      }),
    )
  })
})
