import { Redis } from "ioredis"
import type { BrokerMessage, MessageBrokerPort } from "../../domain/ports/message-broker.port.js"
import type { Logger } from "../../domain/ports/logger.port.js"

export interface RedisStreamConsumerConfig {
  redisUrl: string
  streamKey: string
  groupName: string
  consumerName: string
}

type RedisStreamEntry = [id: string, fields: string[]]

/**
 * Redis Streams consumer using XREADGROUP / XACK / XAUTOCLAIM.
 *
 * Message field convention:
 *   event   = event name (e.g. "scrape-shopping-suggestions")
 *   payload = JSON-encoded event payload
 *
 * Note: kept in the codebase for reference / tests. The production composition
 * root (`main.ts`) starts Cloudflare Queues only.
 */
export class RedisStreamConsumer implements MessageBrokerPort {
  private readonly redis: Redis

  constructor(
    private readonly config: RedisStreamConsumerConfig,
    private readonly logger: Logger,
    redisClient?: Redis,
  ) {
    this.redis = redisClient ?? new Redis(config.redisUrl, { maxRetriesPerRequest: null })
  }

  async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup(
        "CREATE",
        this.config.streamKey,
        this.config.groupName,
        "0",
        "MKSTREAM",
      )
      this.logger.info("Created Redis consumer group", {
        stream: this.config.streamKey,
        group: this.config.groupName,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("BUSYGROUP")) {
        this.logger.debug("Consumer group already exists", {
          group: this.config.groupName,
        })
        return
      }
      throw err
    }
  }

  async readMessages(count: number, blockMs: number): Promise<BrokerMessage[]> {
    const result = (await this.redis.xreadgroup(
      "GROUP",
      this.config.groupName,
      this.config.consumerName,
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      this.config.streamKey,
      ">",
    )) as Array<[string, RedisStreamEntry[]]> | null

    if (!result || result.length === 0) return []

    const first = result[0]
    if (!first) return []

    const entries = first[1] ?? []
    return entries.map(([id, flatFields]) => ({
      id,
      fields: flatToRecord(flatFields),
    }))
  }

  async acknowledge(messageId: string): Promise<void> {
    await this.redis.xack(this.config.streamKey, this.config.groupName, messageId)
  }

  async claimIdleMessages(count: number, minIdleMs: number): Promise<BrokerMessage[]> {
    // XAUTOCLAIM key group consumer min-idle-time start [COUNT count]
    const reply = (await this.redis.xautoclaim(
      this.config.streamKey,
      this.config.groupName,
      this.config.consumerName,
      minIdleMs,
      "0-0",
      "COUNT",
      count,
    )) as [string, RedisStreamEntry[], string[]?]

    const entries = reply[1] ?? []
    return entries.map(([id, flatFields]) => ({
      id,
      fields: flatToRecord(flatFields),
    }))
  }

  async disconnect(): Promise<void> {
    await this.redis.quit()
  }
}

function flatToRecord(flat: string[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const key = flat[i]
    const value = flat[i + 1]
    if (key !== undefined && value !== undefined) {
      record[key] = value
    }
  }
  return record
}
