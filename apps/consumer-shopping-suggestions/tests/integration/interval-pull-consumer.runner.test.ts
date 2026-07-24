import { describe, expect, it, vi } from "vitest"
import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "../../src/application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "../../src/application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { SCRAPE_SHOPPING_SUGGESTIONS_EVENT } from "../../src/domain/events/scrape-shopping-suggestions.event.js"
import type { CachePort } from "../../src/domain/ports/cache.port.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import type { MarketplaceScraperPort } from "../../src/domain/ports/marketplace-scraper.port.js"
import type {
  PulledQueueMessage,
  QueuePullPort,
} from "../../src/domain/ports/queue-pull.port.js"
import type { ScrapedProductsRepositoryPort } from "../../src/domain/ports/scraped-products.repository.port.js"
import type { WardrobePanoramaRepositoryPort } from "../../src/domain/ports/wardrobe-panorama.repository.port.js"
import { IntervalPullConsumerRunner } from "../../src/presentation/interval-pull-consumer.runner.js"

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

class InMemoryQueuePull implements QueuePullPort {
  readonly acked: string[] = []
  private batches: PulledQueueMessage[][] = []
  pullCount = 0

  enqueueBatch(messages: PulledQueueMessage[]): void {
    this.batches.push(messages)
  }

  async pull(batchSize: number): Promise<PulledQueueMessage[]> {
    this.pullCount += 1
    const batch = this.batches.shift() ?? []
    return batch.slice(0, batchSize)
  }

  async acknowledge(messages: PulledQueueMessage[]): Promise<void> {
    for (const msg of messages) {
      this.acked.push(msg.id)
    }
  }

  async retry(): Promise<void> {}

  async disconnect(): Promise<void> {}
}

describe("IntervalPullConsumerRunner (integration)", () => {
  it("pulls a batch, processes with concurrency, and acknowledges successes", async () => {
    const scrapedUsers: string[] = []

    const scraper: MarketplaceScraperPort = {
      marketplace: "enjoei",
      scrape: async ({ userId }) => {
        scrapedUsers.push(userId)
        await new Promise((r) => setTimeout(r, 15))
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

    const queue = new InMemoryQueuePull()
    queue.enqueueBatch(
      Array.from({ length: 5 }, (_, i) => ({
        id: `msg-${i}`,
        leaseId: `lease-${i}`,
        fields: {
          event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
          payload: JSON.stringify({
            marketplace: "enjoei",
            userid: `user-${i}`,
            search_terms: ["vestido"],
          }),
        },
      })),
    )

    const runner = new IntervalPullConsumerRunner(
      queue,
      router,
      { batchSize: 10, intervalMs: 60_000, concurrency: 3 },
      silentLogger(),
    )

    void runner.start()

    await vi.waitFor(() => {
      expect(queue.acked).toHaveLength(5)
    }, { timeout: 5000 })

    await runner.stop()

    expect(queue.pullCount).toBeGreaterThanOrEqual(1)
    expect(scrapedUsers.sort()).toEqual([
      "user-0",
      "user-1",
      "user-2",
      "user-3",
      "user-4",
    ])
  })

  it("acknowledges messages that fail processing to remove them from the queue", async () => {
    const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
      resolveScraper: () => {
        throw new Error("boom")
      },
      logger: silentLogger(),
      ...stubPersistenceDeps(),
    })

    const router = new EventRouter(silentLogger())
    router.register(new ScrapeShoppingSuggestionsHandler(useCase))

    const queue = new InMemoryQueuePull()
    queue.enqueueBatch([
      {
        id: "bad-1",
        leaseId: "lease-bad",
        fields: {
          event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
          payload: JSON.stringify({
            marketplace: "enjoei",
            userid: "u1",
            search_terms: ["x"],
          }),
        },
      },
    ])

    const runner = new IntervalPullConsumerRunner(
      queue,
      router,
      { batchSize: 10, intervalMs: 60_000, concurrency: 1 },
      silentLogger(),
    )

    void runner.start()

    await vi.waitFor(() => {
      expect(queue.acked).toEqual(["bad-1"])
    }, { timeout: 2000 })

    await runner.stop()
  })

  it("respects batchSize when pulling", async () => {
    const pull = vi.fn().mockResolvedValue([])
    const queue: QueuePullPort = {
      pull,
      acknowledge: vi.fn(),
      retry: vi.fn(),
      disconnect: vi.fn(),
    }

    const router = new EventRouter(silentLogger())
    const runner = new IntervalPullConsumerRunner(
      queue,
      router,
      { batchSize: 7, intervalMs: 60_000, concurrency: 2 },
      silentLogger(),
    )

    void runner.start()

    await vi.waitFor(() => {
      expect(pull).toHaveBeenCalled()
    }, { timeout: 2000 })

    await runner.stop()

    expect(pull).toHaveBeenCalledWith(7)
  })
})
