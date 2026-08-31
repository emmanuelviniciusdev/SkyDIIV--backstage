import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleSchedule } from "../../src/scheduler"

const {
  mockVerify,
  mockFindAllIds,
  mockInsert,
  mockBatchJSON,
} = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockFindAllIds: vi.fn(),
  mockInsert: vi.fn(),
  mockBatchJSON: vi.fn(),
}))

vi.mock("../../src/lib/qstash", () => ({
  getQStashReceiver: vi.fn(() => ({ verify: mockVerify })),
  getQStashClient: vi.fn(() => ({ batchJSON: mockBatchJSON })),
}))

vi.mock("../../src/lib/db/client", () => ({
  getDb: vi.fn(() => ({})),
  resetDbClient: vi.fn(),
}))

vi.mock("../../src/lib/db/wardrobe-panorama-ids.repository", () => ({
  SqlWardrobePanoramaIdsRepository: vi.fn(function (this: { findAllIds: typeof mockFindAllIds }) {
    this.findAllIds = mockFindAllIds
  }),
}))

vi.mock("../../src/lib/db/outbox-events.repository", () => ({
  SqlOutboxEventsRepository: vi.fn(function (this: {
    insertGenerateSearchTerms: typeof mockInsert
  }) {
    this.insertGenerateSearchTerms = mockInsert
  }),
}))

import {
  generateSearchTermsProductsScrapingFlow,
  insertAndPublishGenerateSearchTerms,
} from "../../src/flows/generate-search-terms-products-scraping.flow"

function makeFridayRequest(signature: string | null): Request {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (signature) headers.set("upstash-signature", signature)
  return new Request("https://worker-scheduler.workers.dev/schedule/every-friday", {
    method: "POST",
    headers,
    body: "{}",
  })
}

describe("generateSearchTermsProductsScrapingFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKER_OUTBOX_EVENTS_URL = "https://worker-outbox-events.example.workers.dev"
    process.env.QSTASH_TOKEN = "test-token"
    process.env.QSTASH_CURRENT_SIGNING_KEY = "current"
    process.env.QSTASH_NEXT_SIGNING_KEY = "next"
  })

  it("returns 401 for an unsigned Friday schedule request", async () => {
    const res = await handleSchedule(makeFridayRequest(null), "friday")
    expect(res.status).toBe(401)
    expect(mockFindAllIds).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("inserts one outbox row per panorama and publishes each id", async () => {
    mockFindAllIds.mockResolvedValueOnce(["p1", "p2"])
    mockInsert
      .mockResolvedValueOnce("outbox-1")
      .mockResolvedValueOnce("outbox-2")
    mockBatchJSON.mockResolvedValueOnce([])

    const result = await generateSearchTermsProductsScrapingFlow.run()

    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(mockInsert).toHaveBeenNthCalledWith(1, { wardrobePanoramaId: "p1" })
    expect(mockInsert).toHaveBeenNthCalledWith(2, { wardrobePanoramaId: "p2" })
    expect(mockBatchJSON).toHaveBeenCalledTimes(1)
    const [messages] = mockBatchJSON.mock.calls[0] as [
      Array<{ url: string; body: { outboxEventId: string } }>,
    ]
    expect(messages).toHaveLength(2)
    expect(messages.map((m) => m.body)).toEqual([
      { outboxEventId: "outbox-1" },
      { outboxEventId: "outbox-2" },
    ])
    expect(messages[0]!.url).toBe(
      "https://worker-outbox-events.example.workers.dev/process-outbox-event",
    )
    expect(result).toEqual({
      flow: "generate-search-terms-products-scraping",
      dispatched: 2,
    })
  })

  it("returns dispatched 0 when there are no panoramas", async () => {
    mockFindAllIds.mockResolvedValueOnce([])

    const result = await generateSearchTermsProductsScrapingFlow.run()

    expect(result).toEqual({
      flow: "generate-search-terms-products-scraping",
      dispatched: 0,
    })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockBatchJSON).not.toHaveBeenCalled()
  })

  it("splits 101 ids into two QStash batches", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `p${i}`)
    mockInsert.mockImplementation((payload: { wardrobePanoramaId: string }) =>
      Promise.resolve(`outbox-${payload.wardrobePanoramaId}`),
    )
    mockBatchJSON.mockResolvedValue([])

    const { inserted, published } = await insertAndPublishGenerateSearchTerms(ids)

    expect(inserted).toBe(101)
    expect(published).toBe(101)
    expect(mockBatchJSON).toHaveBeenCalledTimes(2)
    expect(
      (mockBatchJSON.mock.calls[0]![0] as unknown[]).length,
    ).toBe(100)
    expect(
      (mockBatchJSON.mock.calls[1]![0] as unknown[]).length,
    ).toBe(1)
  })

  it("leaves inserted rows PENDING when QStash publish fails", async () => {
    mockInsert.mockResolvedValueOnce("outbox-pending")
    mockBatchJSON.mockRejectedValueOnce(new Error("QStash down"))

    const result = await insertAndPublishGenerateSearchTerms(["p1"])

    expect(mockInsert).toHaveBeenCalledWith({ wardrobePanoramaId: "p1" })
    expect(result).toEqual({ inserted: 1, published: 0 })
  })
})
