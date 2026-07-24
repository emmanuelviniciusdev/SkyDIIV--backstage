import type { EventRouter } from "../application/services/event-router.js"
import type { BrokerMessage, MessageBrokerPort } from "../domain/ports/message-broker.port.js"
import type { Logger } from "../domain/ports/logger.port.js"

export interface StreamConsumerRunnerConfig {
  concurrency: number
  blockMs: number
  claimIdleMs: number
}

/**
 * Pulls messages from the broker and processes them with bounded parallelism.
 *
 * At most `concurrency` messages are in-flight at once. Idle pending messages
 * are periodically claimed for crash recovery.
 *
 * Note: kept for the unused Redis Streams path. Production uses
 * {@link IntervalPullConsumerRunner} with Cloudflare Queues.
 */
export class StreamConsumerRunner {
  private running = false
  private inFlight = 0

  constructor(
    private readonly broker: MessageBrokerPort,
    private readonly router: EventRouter,
    private readonly config: StreamConsumerRunnerConfig,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await this.broker.ensureConsumerGroup()
    this.running = true
    this.logger.info("Consumer started", {
      concurrency: this.config.concurrency,
      blockMs: this.config.blockMs,
    })

    while (this.running) {
      try {
        const slots = this.config.concurrency - this.inFlight
        if (slots <= 0) {
          await sleep(25)
          continue
        }

        const claimed = await this.broker.claimIdleMessages(slots, this.config.claimIdleMs)
        const remaining = slots - claimed.length
        const fresh =
          remaining > 0
            ? await this.broker.readMessages(remaining, this.config.blockMs)
            : []

        const batch = [...claimed, ...fresh]
        if (batch.length === 0) {
          continue
        }

        for (const msg of batch) {
          void this.processMessage(msg)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error("Consumer loop error", { error: message })
        await sleep(1000)
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.logger.info("Consumer stop requested — waiting for in-flight work")
    while (this.inFlight > 0) {
      await sleep(50)
    }
    await this.broker.disconnect()
    this.logger.info("Consumer stopped")
  }

  private async processMessage(msg: BrokerMessage): Promise<void> {
    this.inFlight += 1
    try {
      this.logger.info("Processing message", { messageId: msg.id })
      try {
        await this.router.route(msg.fields)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(
          "Message processing failed — acknowledging to remove from stream",
          {
            messageId: msg.id,
            error: message,
          },
        )
      }

      await this.broker.acknowledge(msg.id)
      this.logger.info("Message acknowledged", { messageId: msg.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error("Failed to acknowledge stream message", {
        messageId: msg.id,
        error: message,
      })
    } finally {
      this.inFlight -= 1
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
