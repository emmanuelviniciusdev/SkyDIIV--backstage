import { describe, expect, it, vi } from "vitest"
import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "../../src/application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "../../src/application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { SCRAPE_SHOPPING_SUGGESTIONS_EVENT } from "../../src/domain/events/scrape-shopping-suggestions.event.js"
import type { BrokerMessage, MessageBrokerPort } from "../../src/domain/ports/message-broker.port.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import type { CachePort } from "../../src/domain/ports/cache.port.js"
import type { MarketplaceScraperPort } from "../../src/domain/ports/marketplace-scraper.port.js"
import type { ScrapedProductsRepositoryPort } from "../../src/domain/ports/scraped-products.repository.port.js"
import type { WardrobePanoramaRepositoryPort } from "../../src/domain/ports/wardrobe-panorama.repository.port.js"
import { StreamConsumerRunner } from "../../src/presentation/stream-consumer.runner.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function stubPersistenceDeps(): {
  wardrobePanoramaRepository: WardrobePanoramaRepositoryPort
  scrapedProductsRepository: ScrapedProductsRepositoryPort
  cache: CachePort
} {
  return {
    wardrobePanoramaRepository: {
      findIdByUserId: vi.fn().mockResolvedValue("panorama-1"),
    },
    scrapedProductsRepository: {
      findClothingItemProductTypeId: vi.fn().mockResolvedValue("product-type-1"),
      replaceForPanorama: vi.fn().mockResolvedValue(undefined),
    },
    cache: {
      invalidateShoppingSuggestions: vi.fn().mockResolvedValue(undefined),
      setNewShoppingSuggestionsNotification: vi.fn().mockResolvedValue(undefined),
    },
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
      ...stubPersistenceDeps(),
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
            userId: `user-${i}`,
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

  it("acknowledges messages that fail processing to remove them from the stream", async () => {
    const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
      resolveScraper: () => {
        throw new Error("boom")
      },
      logger: silentLogger(),
      ...stubPersistenceDeps(),
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
          userId: "u1",
          searchParams: [
            {
              searchTerm: "x",
              gender: null,
              topSize: null,
              bottomSize: null,
              footSize: null,
              brand: null,
            },
          ],
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
      expect(broker.acked).toEqual(["bad-1"])
    }, { timeout: 2000 })

    await runner.stop()
  })
})
