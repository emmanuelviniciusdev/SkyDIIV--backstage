import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudflareQueuesConsumer } from "../../src/infrastructure/messaging/cloudflare-queues.consumer.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("CloudflareQueuesConsumer", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("pulls messages and maps event/payload into broker fields", async () => {
    const payload = {
      marketplace: "enjoei",
      userid: "user-1",
      search_terms: ["vestido"],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          message_backlog_count: 1,
          messages: [
            {
              id: "msg-1",
              lease_id: "lease-1",
              body: JSON.stringify({
                event: "scrape-shopping-suggestions",
                payload,
              }),
              metadata: { "CF-Content-Type": "text" },
            },
          ],
        },
      }),
    })

    const consumer = new CloudflareQueuesConsumer(
      {
        accountId: "acc-1",
        queueId: "queue-1",
        apiToken: "token",
        visibilityTimeoutMs: 60_000,
      },
      silentLogger(),
      fetchMock,
    )

    const messages = await consumer.pull(10)

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc-1/queues/queue-1/messages/pull",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          batch_size: 10,
          visibility_timeout_ms: 60_000,
        }),
      }),
    )
    expect(messages).toEqual([
      {
        id: "msg-1",
        leaseId: "lease-1",
        fields: {
          event: "scrape-shopping-suggestions",
          payload: JSON.stringify(payload),
        },
      },
    ])
  })

  it("decodes base64 JSON bodies", async () => {
    const envelope = {
      event: "scrape-shopping-suggestions",
      payload: { marketplace: "enjoei", userid: "u1", search_terms: ["x"] },
    }
    const encoded = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64")

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          messages: [
            {
              id: "msg-b64",
              lease_id: "lease-b64",
              body: encoded,
              metadata: { "CF-Content-Type": "json" },
            },
          ],
        },
      }),
    })

    const consumer = new CloudflareQueuesConsumer(
      {
        accountId: "acc-1",
        queueId: "queue-1",
        apiToken: "token",
        visibilityTimeoutMs: 60_000,
      },
      silentLogger(),
      fetchMock,
    )

    const messages = await consumer.pull(1)
    expect(messages[0]?.fields["event"]).toBe("scrape-shopping-suggestions")
    expect(JSON.parse(messages[0]!.fields["payload"]!)).toEqual(envelope.payload)
  })

  it("acknowledges messages by lease_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })

    const consumer = new CloudflareQueuesConsumer(
      {
        accountId: "acc-1",
        queueId: "queue-1",
        apiToken: "token",
        visibilityTimeoutMs: 60_000,
      },
      silentLogger(),
      fetchMock,
    )

    await consumer.acknowledge([
      {
        id: "msg-1",
        leaseId: "lease-1",
        fields: { event: "scrape-shopping-suggestions", payload: "{}" },
      },
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc-1/queues/queue-1/messages/ack",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          acks: [{ lease_id: "lease-1" }],
          retries: [],
        }),
      }),
    )
  })

  it("throws when pull HTTP fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    })

    const consumer = new CloudflareQueuesConsumer(
      {
        accountId: "acc-1",
        queueId: "queue-1",
        apiToken: "token",
        visibilityTimeoutMs: 60_000,
      },
      silentLogger(),
      fetchMock,
    )

    await expect(consumer.pull(10)).rejects.toThrow(/pull failed \(503\)/)
  })
})
