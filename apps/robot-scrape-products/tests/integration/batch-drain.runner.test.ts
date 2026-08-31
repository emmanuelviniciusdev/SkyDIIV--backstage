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
import type { SelfDeletePort } from "../../src/domain/ports/self-delete.port.js"
import type { WardrobePanoramaRepositoryPort } from "../../src/domain/ports/wardrobe-panorama.repository.port.js"
import { BatchDrainRunner } from "../../src/presentation/batch-drain.runner.js"

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

class RecordingSelfDelete implements SelfDeletePort {
  calls = 0
  async deleteSelf(): Promise<void> {
    this.calls += 1
  }
}

function makeMessage(id: string, userId: string): PulledQueueMessage {
  return {
    id,
    leaseId: `lease-${id}`,
    fields: {
      event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
      payload: JSON.stringify({
        marketplace: "enjoei",
        userId,
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
  }
}

describe("BatchDrainRunner (integration)", () => {
  it("drains all batches (2 at a time) then self-deletes", async () => {
    const scrapedUsers: string[] = []

    const scraper: MarketplaceScraperPort = {
      marketplace: "enjoei",
      scrape: async ({ userId }) => {
        scrapedUsers.push(userId)
        await new Promise((r) => setTimeout(r, 10))
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
    queue.enqueueBatch([makeMessage("msg-0", "user-0"), makeMessage("msg-1", "user-1")])
    queue.enqueueBatch([makeMessage("msg-2", "user-2"), makeMessage("msg-3", "user-3")])
    queue.enqueueBatch([makeMessage("msg-4", "user-4")])

    const selfDelete = new RecordingSelfDelete()
    const runner = new BatchDrainRunner(
      queue,
      router,
      selfDelete,
      { batchSize: 2, concurrency: 2 },
      silentLogger(),
    )

    await runner.start()

    expect(queue.acked).toHaveLength(5)
    expect(scrapedUsers.sort()).toEqual([
      "user-0",
      "user-1",
      "user-2",
      "user-3",
      "user-4",
    ])
    expect(selfDelete.calls).toBe(1)
    expect(queue.pullCount).toBeGreaterThanOrEqual(4) // 3 batches + empty
  })

  it("self-deletes immediately when the queue is already empty", async () => {
    const queue = new InMemoryQueuePull()
    const selfDelete = new RecordingSelfDelete()
    const router = new EventRouter(silentLogger())

    const runner = new BatchDrainRunner(
      queue,
      router,
      selfDelete,
      { batchSize: 2, concurrency: 2 },
      silentLogger(),
    )

    await runner.start()

    expect(queue.acked).toEqual([])
    expect(selfDelete.calls).toBe(1)
  })

  it("acknowledges messages that fail processing, then self-deletes", async () => {
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
    queue.enqueueBatch([makeMessage("bad-1", "u1")])

    const selfDelete = new RecordingSelfDelete()
    const runner = new BatchDrainRunner(
      queue,
      router,
      selfDelete,
      { batchSize: 2, concurrency: 2 },
      silentLogger(),
    )

    await runner.start()

    expect(queue.acked).toEqual(["bad-1"])
    expect(selfDelete.calls).toBe(1)
  })

  it("respects batchSize when pulling", async () => {
    const pull = vi.fn().mockResolvedValue([])
    const queue: QueuePullPort = {
      pull,
      acknowledge: vi.fn(),
      retry: vi.fn(),
      disconnect: vi.fn(),
    }
    const selfDelete = new RecordingSelfDelete()
    const router = new EventRouter(silentLogger())

    const runner = new BatchDrainRunner(
      queue,
      router,
      selfDelete,
      { batchSize: 2, concurrency: 2 },
      silentLogger(),
    )

    await runner.start()

    expect(pull).toHaveBeenCalledWith(2)
    expect(selfDelete.calls).toBe(1)
  })
})
