import type { EventRouter } from "../application/services/event-router.js"
import type { Logger } from "../domain/ports/logger.port.js"
import type {
  PulledQueueMessage,
  QueuePullPort,
} from "../domain/ports/queue-pull.port.js"
import type { SelfDeletePort } from "../domain/ports/self-delete.port.js"

export interface BatchDrainRunnerConfig {
  /** Max messages pulled per cycle (also used as concurrency cap). */
  batchSize: number
  /** Max in-flight messages within a single pull batch. */
  concurrency: number
}

/**
 * Drain-until-empty queue runner for CRON / Container Instance jobs.
 *
 * Pulls up to `batchSize` messages, processes with bounded concurrency,
 * always ACKs, and repeats until a pull returns empty. Then calls
 * {@link SelfDeletePort.deleteSelf} so PAYG compute stops billing.
 *
 * Terraform destroy (Sunday 09:00) has absolute authority regardless of
 * remaining queue depth — this runner does not resist external teardown.
 */
export class BatchDrainRunner {
  private running = false
  private inFlight = 0

  constructor(
    private readonly queue: QueuePullPort,
    private readonly router: EventRouter,
    private readonly selfDelete: SelfDeletePort,
    private readonly config: BatchDrainRunnerConfig,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.running = true
    this.logger.info("Batch drain runner started", {
      batchSize: this.config.batchSize,
      concurrency: this.config.concurrency,
    })

    let totalProcessed = 0

    try {
      while (this.running) {
        let messages: PulledQueueMessage[]
        try {
          messages = await this.queue.pull(this.config.batchSize)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.logger.error("Queue pull failed — aborting drain", { error: message })
          break
        }

        if (messages.length === 0) {
          this.logger.info("Queue empty — drain complete", { totalProcessed })
          break
        }

        this.logger.info("Processing queue batch", {
          count: messages.length,
          totalProcessed,
        })

        await this.processBatch(messages)
        totalProcessed += messages.length
      }
    } finally {
      await this.queue.disconnect()
      this.logger.info("Invoking self-delete after drain", { totalProcessed })
      try {
        await this.selfDelete.deleteSelf()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error("Self-delete failed — GHA terraform destroy remains the fallback", {
          error: message,
        })
      }
      this.running = false
      this.logger.info("Batch drain runner finished", { totalProcessed })
    }
  }

  async stop(): Promise<void> {
    this.running = false
    this.logger.info("Batch drain stop requested — waiting for in-flight work")
    while (this.inFlight > 0) {
      await sleep(50)
    }
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
