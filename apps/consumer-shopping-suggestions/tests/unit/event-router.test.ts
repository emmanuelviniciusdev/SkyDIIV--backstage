import { describe, expect, it, vi } from "vitest"
import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "../../src/application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "../../src/application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { SCRAPE_SHOPPING_SUGGESTIONS_EVENT } from "../../src/domain/events/scrape-shopping-suggestions.event.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("EventRouter", () => {
  it("routes a valid scrape-shopping-suggestions message", async () => {
    const execute = vi.fn().mockResolvedValue({
      marketplace: "enjoei",
      userId: "u1",
      products: [],
      scrapedAt: new Date(),
    })

    const useCase = {
      execute,
    } as unknown as ProcessScrapeShoppingSuggestionsUseCase

    const router = new EventRouter(silentLogger())
    router.register(new ScrapeShoppingSuggestionsHandler(useCase))

    await router.route({
      event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
      payload: JSON.stringify({
        marketplace: "enjoei",
        userid: "u1",
        search_terms: ["jaqueta"],
      }),
    })

    expect(execute).toHaveBeenCalledWith({
      marketplace: "enjoei",
      userid: "u1",
      search_terms: ["jaqueta"],
    })
  })

  it("rejects messages missing required fields", async () => {
    const router = new EventRouter(silentLogger())
    await expect(router.route({ event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT })).rejects.toThrow(
      /event.*payload/i,
    )
  })

  it("rejects invalid JSON payload", async () => {
    const router = new EventRouter(silentLogger())
    await expect(
      router.route({
        event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
        payload: "{not-json",
      }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it("rejects unregistered events after schema would fail", async () => {
    const router = new EventRouter(silentLogger())
    await expect(
      router.route({
        event: "unknown-event",
        payload: JSON.stringify({
          marketplace: "enjoei",
          userid: "u1",
          search_terms: ["x"],
        }),
      }),
    ).rejects.toThrow(/Invalid stream message/)
  })
})
