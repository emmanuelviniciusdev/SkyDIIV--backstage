import { describe, expect, it, vi } from "vitest"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import { RedisStreamConsumer } from "../../src/infrastructure/messaging/redis-stream.consumer.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

/**
 * Lightweight fake Redis client covering the subset used by RedisStreamConsumer.
 */
function createFakeRedis() {
  const groups = new Set<string>()
  const streams = new Map<string, Array<{ id: string; fields: string[] }>>()
  let idSeq = 1

  const client = {
    xgroup: vi.fn(async (...args: unknown[]) => {
      const stream = String(args[1])
      const group = String(args[2])
      const key = `${stream}:${group}`
      if (groups.has(key)) {
        const err = new Error("BUSYGROUP Consumer Group name already exists")
        throw err
      }
      groups.add(key)
      if (!streams.has(stream)) streams.set(stream, [])
      return "OK"
    }),
    xreadgroup: vi.fn(async (...args: unknown[]) => {
      // GROUP group consumer COUNT n BLOCK ms STREAMS key >
      const streamKey = String(args[8])
      const entries = streams.get(streamKey) ?? []
      if (entries.length === 0) return null
      const batch = entries.splice(0, Number(args[4]))
      return [[streamKey, batch.map((e) => [e.id, e.fields])]]
    }),
    xack: vi.fn(async () => 1),
    xautoclaim: vi.fn(async () => ["0-0", [], []]),
    quit: vi.fn(async () => "OK"),
    // test helper
    __push(stream: string, fields: Record<string, string>) {
      const flat = Object.entries(fields).flat()
      const list = streams.get(stream) ?? []
      list.push({ id: `${idSeq}-0`, fields: flat })
      idSeq += 1
      streams.set(stream, list)
    },
  }

  return client
}

describe("RedisStreamConsumer (integration with fake Redis)", () => {
  it("creates the consumer group idempotently", async () => {
    const redis = createFakeRedis()
    const consumer = new RedisStreamConsumer(
      {
        redisUrl: "redis://test",
        streamKey: "shopping-suggestions",
        groupName: "g1",
        consumerName: "c1",
      },
      silentLogger(),
      redis as never,
    )

    await consumer.ensureConsumerGroup()
    await consumer.ensureConsumerGroup()

    expect(redis.xgroup).toHaveBeenCalledTimes(2)
  })

  it("reads and acknowledges messages", async () => {
    const redis = createFakeRedis()
    redis.__push("shopping-suggestions", {
      event: "scrape-shopping-suggestions",
      payload: JSON.stringify({
        marketplace: "enjoei",
        userId: "u1",
        searchParams: [
          {
            searchTerm: "vestido",
            gender: null,
            topSize: null,
            bottomSize: null,
            footSize: null,
            brand: null,
          },
        ],
      }),
    })

    const consumer = new RedisStreamConsumer(
      {
        redisUrl: "redis://test",
        streamKey: "shopping-suggestions",
        groupName: "g1",
        consumerName: "c1",
      },
      silentLogger(),
      redis as never,
    )

    await consumer.ensureConsumerGroup()
    const messages = await consumer.readMessages(10, 100)

    expect(messages).toHaveLength(1)
    expect(messages[0]?.fields["event"]).toBe("scrape-shopping-suggestions")
    expect(messages[0]?.id).toBe("1-0")

    await consumer.acknowledge(messages[0]!.id)
    expect(redis.xack).toHaveBeenCalledWith("shopping-suggestions", "g1", "1-0")

    await consumer.disconnect()
    expect(redis.quit).toHaveBeenCalled()
  })
})
