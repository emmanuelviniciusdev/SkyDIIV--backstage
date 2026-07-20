import { describe, expect, it, vi } from "vitest"
import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "../../src/application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "../../src/application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { SCRAPE_SHOPPING_SUGGESTIONS_EVENT } from "../../src/domain/events/scrape-shopping-suggestions.event.js"
import type { BrokerMessage, MessageBrokerPort } from "../../src/domain/ports/message-broker.port.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import type { MarketplaceScraperPort } from "../../src/domain/ports/marketplace-scraper.port.js"
import { StreamConsumerRunner } from "../../src/presentation/stream-consumer.runner.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

class InMemoryBroker implements MessageBrokerPort {
  readonly acked: string[] = []
  private queue: BrokerMessage[] = []
  private reads = 0

  enqueue(msg: BrokerMessage): void {
    this.queue.push(msg)
  }

  async ensureConsumerGroup(): Promise<void> {}

  async readMessages(count: number, blockMs: number): Promise<BrokerMessage[]> {
    void blockMs
    this.reads += 1
    if (this.queue.length === 0) {
      // Simulate Redis BLOCK by yielding briefly when empty.
      await new Promise((r) => setTimeout(r, 5))
      return []
    }
    return this.queue.splice(0, count)
  }

  async acknowledge(messageId: string): Promise<void> {
    this.acked.push(messageId)
  }

  async claimIdleMessages(): Promise<BrokerMessage[]> {
    return []
  }

  async disconnect(): Promise<void> {}

  get readCount(): number {
    return this.reads
  }
}

describe("StreamConsumerRunner (integration)", () => {
  it("processes messages in parallel up to concurrency and acknowledges them", async () => {
    const scrapedUsers: string[] = []

    const scraper: MarketplaceScraperPort = {
      marketplace: "enjoei",
      scrape: async ({ userId }) => {
        scrapedUsers.push(userId)
        await new Promise((r) => setTimeout(r, 20))
        return []
      },
    }

    const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
      resolveScraper: () => scraper,
      logger: silentLogger(),
    })

    const router = new EventRouter(silentLogger())
    router.register(new ScrapeShoppingSuggestionsHandler(useCase))

    const broker = new InMemoryBroker()
    for (let i = 0; i < 5; i++) {
      broker.enqueue({
        id: `msg-${i}`,
        fields: {
          event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
          payload: JSON.stringify({
            marketplace: "enjoei",
            userid: `user-${i}`,
            search_terms: ["vestido"],
          }),
        },
      })
    }

    const runner = new StreamConsumerRunner(
      broker,
      router,
      { concurrency: 3, blockMs: 10, claimIdleMs: 60_000 },
      silentLogger(),
    )

    void runner.start()

    await vi.waitFor(() => {
      expect(broker.acked).toHaveLength(5)
    }, { timeout: 5000 })

    await runner.stop()

    expect(scrapedUsers.sort()).toEqual([
      "user-0",
      "user-1",
      "user-2",
      "user-3",
      "user-4",
    ])
    expect(broker.acked.sort()).toEqual([
      "msg-0",
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
    ])
  })

  it("does not acknowledge messages that fail processing", async () => {
    const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
      resolveScraper: () => {
        throw new Error("boom")
      },
      logger: silentLogger(),
    })

    const router = new EventRouter(silentLogger())
    router.register(new ScrapeShoppingSuggestionsHandler(useCase))

    const broker = new InMemoryBroker()
    broker.enqueue({
      id: "bad-1",
      fields: {
        event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
        payload: JSON.stringify({
          marketplace: "enjoei",
          userid: "u1",
          search_terms: ["x"],
        }),
      },
    })

    const runner = new StreamConsumerRunner(
      broker,
      router,
      { concurrency: 1, blockMs: 10, claimIdleMs: 60_000 },
      silentLogger(),
    )

    void runner.start()

    await vi.waitFor(() => {
      expect(broker.readCount).toBeGreaterThanOrEqual(1)
    }, { timeout: 2000 })

    await new Promise((r) => setTimeout(r, 50))
    await runner.stop()

    expect(broker.acked).toEqual([])
  })
})
