import { describe, expect, it } from "vitest"
import {
  SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
  scrapeShoppingSuggestionsPayloadSchema,
  streamMessageSchema,
  toSearchParams,
} from "../../src/domain/events/scrape-shopping-suggestions.event.js"

const sampleParams = {
  searchTerm: "vestido floral",
  gender: "Female",
  topSize: "M",
  bottomSize: "40",
  footSize: "38",
  brand: "Zara",
}

describe("scrapeShoppingSuggestionsPayloadSchema", () => {
  it("accepts a valid payload with searchParams", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userId: "user-1",
      searchParams: [
        sampleParams,
        {
          searchTerm: "jaqueta jeans",
          gender: null,
          topSize: null,
          bottomSize: null,
          footSize: null,
          brand: null,
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty searchParams", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userId: "user-1",
      searchParams: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects searchParams entries without searchTerm", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userId: "user-1",
      searchParams: [
        {
          gender: "Female",
          topSize: "M",
          bottomSize: null,
          footSize: null,
          brand: null,
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing marketplace", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      userId: "user-1",
      searchParams: [sampleParams],
    })
    expect(result.success).toBe(false)
  })

  it("rejects legacy snake_case payload keys", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userid: "user-1",
      search_params: [sampleParams],
    })
    expect(result.success).toBe(false)
  })

  it("rejects legacy searchTerms string-array payloads", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userId: "user-1",
      searchTerms: ["camiseta"],
    })
    expect(result.success).toBe(false)
  })
})

describe("toSearchParams", () => {
  it("maps wire entries to the domain SearchParams type", () => {
    expect(toSearchParams(sampleParams)).toEqual(sampleParams)
  })
})

describe("streamMessageSchema", () => {
  it("accepts the scrape-shopping-suggestions event envelope", () => {
    const result = streamMessageSchema.safeParse({
      event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
      payload: {
        marketplace: "enjoei",
        userId: "u1",
        searchParams: [
          {
            searchTerm: "saia",
            gender: null,
            topSize: null,
            bottomSize: null,
            footSize: null,
            brand: null,
          },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects unknown event names", () => {
    const result = streamMessageSchema.safeParse({
      event: "other-event",
      payload: {
        marketplace: "enjoei",
        userId: "u1",
        searchParams: [
          {
            searchTerm: "saia",
            gender: null,
            topSize: null,
            bottomSize: null,
            footSize: null,
            brand: null,
          },
        ],
      },
    })
    expect(result.success).toBe(false)
  })
})
