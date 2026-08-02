import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  insertScrapeShoppingSuggestions: vi.fn(),
  batchPublishOutboxMessages: vi.fn(),
}))

vi.mock("../../src/lib/db/client", () => ({
  getWriteDb: vi.fn(() => ({})),
}))

vi.mock("../../src/lib/db/outbox-events.repository", () => ({
  SqlOutboxEventsRepository: vi.fn(function (this: {
    insertScrapeShoppingSuggestions: typeof mocks.insertScrapeShoppingSuggestions
  }) {
    this.insertScrapeShoppingSuggestions = mocks.insertScrapeShoppingSuggestions
  }),
}))

vi.mock("../../src/lib/outbox/publish", () => ({
  batchPublishOutboxMessages: mocks.batchPublishOutboxMessages,
}))

import { enqueueShoppingSuggestionsStep } from "../../src/workflows/generate-wardrobe-panorama/steps/enqueue-shopping-suggestions"

describe("enqueueShoppingSuggestionsStep()", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("skips when there are no suggestions", async () => {
    const result = await enqueueShoppingSuggestionsStep({
      userId: "user-1",
      suggestions: [],
      shoppingPreferences: null,
    })

    expect(result).toEqual({ enqueued: false, searchParamCount: 0 })
    expect(mocks.insertScrapeShoppingSuggestions).not.toHaveBeenCalled()
    expect(mocks.batchPublishOutboxMessages).not.toHaveBeenCalled()
  })

  it("inserts an outbox row and publishes via QStash batchJSON", async () => {
    mocks.insertScrapeShoppingSuggestions.mockResolvedValueOnce("outbox-1")
    mocks.batchPublishOutboxMessages.mockResolvedValueOnce(undefined)

    const result = await enqueueShoppingSuggestionsStep({
      userId: "user-1",
      suggestions: [
        { searchTerm: "blazer casual", brand: null, sizeCategory: "top" },
        { searchTerm: "tênis", brand: "Nike", sizeCategory: "foot" },
      ],
      shoppingPreferences: {
        gender: "Female",
        topSize: "M",
        bottomSize: "40",
        footSize: "38",
      },
    })

    expect(mocks.insertScrapeShoppingSuggestions).toHaveBeenCalledWith({
      marketplace: "enjoei",
      userId: "user-1",
      searchParams: [
        {
          searchTerm: "blazer casual",
          gender: "Female",
          topSize: "M",
          bottomSize: null,
          footSize: null,
          brand: null,
        },
        {
          searchTerm: "tênis",
          gender: "Female",
          topSize: null,
          bottomSize: null,
          footSize: "38",
          brand: "Nike",
        },
      ],
    })
    expect(mocks.batchPublishOutboxMessages).toHaveBeenCalledWith(["outbox-1"])
    expect(result).toEqual({
      enqueued: true,
      outboxEventId: "outbox-1",
      searchParamCount: 2,
    })
  })

  it("still returns enqueued when QStash publish fails after insert", async () => {
    mocks.insertScrapeShoppingSuggestions.mockResolvedValueOnce("outbox-2")
    mocks.batchPublishOutboxMessages.mockRejectedValueOnce(new Error("QStash down"))

    const result = await enqueueShoppingSuggestionsStep({
      userId: "user-1",
      suggestions: [
        { searchTerm: "a", brand: null, sizeCategory: "none" },
        { searchTerm: "b", brand: null, sizeCategory: "none" },
      ],
      shoppingPreferences: null,
    })

    expect(result.enqueued).toBe(true)
    expect(result.outboxEventId).toBe("outbox-2")
  })

  it("rethrows insert failures", async () => {
    mocks.insertScrapeShoppingSuggestions.mockRejectedValueOnce(new Error("DB down"))

    await expect(
      enqueueShoppingSuggestionsStep({
        userId: "user-1",
        suggestions: [
          { searchTerm: "a", brand: null, sizeCategory: "none" },
          { searchTerm: "b", brand: null, sizeCategory: "none" },
        ],
        shoppingPreferences: null,
      }),
    ).rejects.toThrow("DB down")
  })
})
