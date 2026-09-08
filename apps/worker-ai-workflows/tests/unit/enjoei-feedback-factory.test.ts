import { describe, it, expect } from "vitest"
import type { FeedbackAutomaticThriftingRow } from "../../src/lib/db/feedbacks-automatic-thrifting.repository"
import {
  factoryFeedbackRow,
  factoryFeedbackRows,
  factoryRecordHasSnapshotKeys,
} from "../../src/lib/automatic-thrifting/feedback-factory"

function makeRow(
  overrides: Partial<FeedbackAutomaticThriftingRow> = {},
): FeedbackAutomaticThriftingRow {
  return {
    id: "f1",
    userId: "u1",
    scrapedProductId: "sp1",
    liked: true,
    reason: "gosto do caimento",
    jsonSearch: {
      term: "camisa preta",
      gender: "Male",
      topSize: "M",
      bottomSize: null,
      footSize: null,
    },
    jsonResult: {
      marketplace: "enjoei",
      title: "camisa preta slim",
      price: 49,
      currency: "BRL",
      url: "https://www.enjoei.com.br/p/camisa-1",
      image_url: "https://photos.enjoei.com.br/x.png",
      metadata: { size: "M" },
    },
    jsonListedProduct: {
      id: "sp1",
      marketplace: "enjoei",
      title: "camisa listed",
      price: 50,
      currency: "BRL",
      url: "https://www.enjoei.com.br/p/camisa-1",
      imageUrl: "https://photos.enjoei.com.br/x.png",
      searchTerm: "camisa",
    },
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  }
}

describe("factoryFeedbackRow (Enjoei)", () => {
  it("maps liked, reason, listing, size, and search fields", () => {
    const record = factoryFeedbackRow(makeRow())
    expect(record).toEqual({
      marketplace: "enjoei",
      liked: true,
      reason: "gosto do caimento",
      title: "camisa listed",
      price: 50,
      currency: "BRL",
      size: "M",
      searchTerm: "camisa preta",
      gender: "Male",
      topSize: "M",
      bottomSize: null,
      footSize: null,
    })
    expect(record && factoryRecordHasSnapshotKeys(record)).toBe(false)
    expect(JSON.stringify(record)).not.toMatch(/image/i)
    expect(JSON.stringify(record)).not.toMatch(/https:\/\//)
    expect(JSON.stringify(record)).not.toMatch(/json_search|jsonSearch|json_result|jsonListedProduct/)
  })

  it("reads size from json_result.metadata.size", () => {
    const record = factoryFeedbackRow(
      makeRow({
        jsonListedProduct: { marketplace: "enjoei", title: "item" },
        jsonResult: { marketplace: "enjoei", metadata: { size: "40" } },
        jsonSearch: null,
      }),
    )
    expect(record?.size).toBe("40")
    expect(record?.title).toBe("item")
  })

  it("nulls missing optional fields", () => {
    const record = factoryFeedbackRow(
      makeRow({
        liked: false,
        reason: null,
        jsonSearch: null,
        jsonResult: { marketplace: "enjoei" },
        jsonListedProduct: { marketplace: "enjoei" },
      }),
    )
    expect(record).toEqual({
      marketplace: "enjoei",
      liked: false,
      reason: null,
      title: null,
      price: null,
      currency: null,
      size: null,
      searchTerm: null,
      gender: null,
      topSize: null,
      bottomSize: null,
      footSize: null,
    })
  })

  it("omits unknown marketplaces", () => {
    expect(
      factoryFeedbackRow(
        makeRow({
          jsonListedProduct: { marketplace: "other-shop", title: "x" },
          jsonResult: { marketplace: "other-shop" },
        }),
      ),
    ).toBeNull()
  })

  it("is case-insensitive for enjoei", () => {
    const record = factoryFeedbackRow(
      makeRow({
        jsonListedProduct: { marketplace: "Enjoei", title: "x" },
        jsonResult: null,
      }),
    )
    expect(record?.marketplace).toBe("enjoei")
    expect(record?.title).toBe("x")
  })
})

describe("factoryFeedbackRows", () => {
  it("drops unknown marketplace rows", () => {
    const records = factoryFeedbackRows([
      makeRow(),
      makeRow({
        id: "f2",
        jsonListedProduct: { marketplace: "unknown" },
        jsonResult: { marketplace: "unknown" },
      }),
    ])
    expect(records).toHaveLength(1)
    expect(records[0]?.marketplace).toBe("enjoei")
  })
})
