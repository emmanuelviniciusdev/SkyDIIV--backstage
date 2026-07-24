import type { EventRouter } from "../application/services/event-router.js"
import type { Logger } from "../domain/ports/logger.port.js"
import type {
  PulledQueueMessage,
  QueuePullPort,
} from "../domain/ports/queue-pull.port.js"

export interface IntervalPullConsumerRunnerConfig {
  /** Max messages pulled per poll cycle. */
  batchSize: number
  /** Delay between poll cycles (ms). */
  intervalMs: number
  /** Max in-flight messages within a single poll batch. */
  concurrency: number
}

/**
 * Pulls a bounded batch from a {@link QueuePullPort} on a fixed interval.
 *
 * Designed for Cloudflare Queues HTTP pull (short-poll): one pull every
 * `intervalMs`, up to `batchSize` messages, processed with bounded concurrency.
 * Messages are always ACKed after processing (success or failure) so they are
 * removed from the queue — no automatic retries.
 */
export class IntervalPullConsumerRunner {
  private running = false
  private inFlight = 0
  private wake: (() => void) | null = null

  constructor(
    private readonly queue: QueuePullPort,
    private readonly router: EventRouter,
    private readonly config: IntervalPullConsumerRunnerConfig,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.running = true
    this.logger.info("Interval pull consumer started", {
      batchSize: this.config.batchSize,
      intervalMs: this.config.intervalMs,
      concurrency: this.config.concurrency,
    })

    while (this.running) {
      const cycleStartedAt = Date.now()

      try {
        await this.pollAndProcess()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error("Interval pull cycle error", { error: message })
      }

      if (!this.running) break

      const elapsed = Date.now() - cycleStartedAt
      const waitMs = Math.max(0, this.config.intervalMs - elapsed)
      this.logger.debug("Waiting until next Cloudflare Queues poll", {
        waitMs,
        intervalMs: this.config.intervalMs,
      })
      await this.interruptibleSleep(waitMs)
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.wake?.()
    this.logger.info("Interval pull consumer stop requested — waiting for in-flight work")
    while (this.inFlight > 0) {
      await sleep(50)
    }
    await this.queue.disconnect()
    this.logger.info("Interval pull consumer stopped")
  }

  private async pollAndProcess(): Promise<void> {
    const messages = await this.queue.pull(this.config.batchSize)
    if (messages.length === 0) {
      this.logger.debug("Cloudflare Queues pull returned no messages")
      return
    }

    this.logger.info("Processing Cloudflare Queues batch", {
      count: messages.length,
    })

    await this.processBatch(messages)
  }

  private async processBatch(messages: PulledQueueMessage[]): Promise<void> {
    let nextIndex = 0

    const workers = Array.from(
      { length: Math.min(this.config.concurrency, messages.length) },
      async () => {
        while (this.running) {
          const index = nextIndex
          nextIndex += 1
          if (index >= messages.length) return

          const msg = messages[index]
          if (!msg) return
          await this.processMessage(msg)
        }
      },
    )

    await Promise.all(workers)
  }

  private async processMessage(msg: PulledQueueMessage): Promise<void> {
    this.inFlight += 1
    try {
      this.logger.info("Processing queue message", { messageId: msg.id })
      try {
        await this.router.route(msg.fields)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error(
          "Queue message processing failed — acknowledging to remove from queue",
          {
            messageId: msg.id,
            error: message,
          },
        )
      }

      await this.queue.acknowledge([msg])
      this.logger.info("Queue message acknowledged", { messageId: msg.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error("Failed to acknowledge queue message", {
        messageId: msg.id,
        error: message,
      })
    } finally {
      this.inFlight -= 1
    }
  }

  private interruptibleSleep(ms: number): Promise<void> {
    if (ms <= 0 || !this.running) return Promise.resolve()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)

      this.wake = () => {
        clearTimeout(timer)
        this.wake = null
        resolve()
      }
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
