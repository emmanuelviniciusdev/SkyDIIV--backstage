import { describe, expect, it } from "vitest"
import {
  SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
  scrapeShoppingSuggestionsPayloadSchema,
  streamMessageSchema,
} from "../../src/domain/events/scrape-shopping-suggestions.event.js"

describe("scrapeShoppingSuggestionsPayloadSchema", () => {
  it("accepts a valid payload", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userid: "user-1",
      search_terms: ["vestido floral", "jaqueta jeans"],
    })
    expect(result.success).toBe(true)
  })

  it("rejects empty search_terms", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      marketplace: "enjoei",
      userid: "user-1",
      search_terms: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing marketplace", () => {
    const result = scrapeShoppingSuggestionsPayloadSchema.safeParse({
      userid: "user-1",
      search_terms: ["camiseta"],
    })
    expect(result.success).toBe(false)
  })
})

describe("streamMessageSchema", () => {
  it("accepts the scrape-shopping-suggestions event envelope", () => {
    const result = streamMessageSchema.safeParse({
      event: SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
      payload: {
        marketplace: "enjoei",
        userid: "u1",
        search_terms: ["saia"],
      },
    })
    expect(result.success).toBe(true)
  })

  it("rejects unknown event names", () => {
    const result = streamMessageSchema.safeParse({
      event: "other-event",
      payload: {
        marketplace: "enjoei",
        userid: "u1",
        search_terms: ["saia"],
      },
    })
    expect(result.success).toBe(false)
  })
})
