import { describe, it, expect } from "vitest"
import { parseWardrobePanoramaIdPayload } from "../../src/lib/automatic-thrifting/payload"
import {
  assignMarketplacesRoundRobin,
  resolveSearchTermsLocale,
  selectEligibleMarketplaces,
} from "../../src/lib/automatic-thrifting/marketplace-eligibility"
import { parseSearchTermsLlmOutput } from "../../src/lib/prompt/search-terms-response"
import { JsonSearchSchema } from "../../src/lib/shopping/compose-search-params"
import { MAX_SEARCH_TERMS } from "../../src/lib/shopping/suggestions"

describe("parseWardrobePanoramaIdPayload", () => {
  it("accepts a non-empty wardrobePanoramaId", () => {
    expect(parseWardrobePanoramaIdPayload({ wardrobePanoramaId: "p1" })).toBe("p1")
  })

  it("rejects missing or empty ids", () => {
    expect(() => parseWardrobePanoramaIdPayload({})).toThrow(/wardrobePanoramaId/)
    expect(() => parseWardrobePanoramaIdPayload({ wardrobePanoramaId: "" })).toThrow(
      /wardrobePanoramaId/,
    )
    expect(() => parseWardrobePanoramaIdPayload({ wardrobePanoramaId: "   " })).toThrow(
      /wardrobePanoramaId/,
    )
  })
})

describe("JsonSearchSchema", () => {
  it("requires term plus gender and size fields", () => {
    expect(
      JsonSearchSchema.parse({
        term: "blazer casual",
        gender: "Female",
        topSize: "M",
        bottomSize: null,
        footSize: null,
      }),
    ).toEqual({
      term: "blazer casual",
      gender: "Female",
      topSize: "M",
      bottomSize: null,
      footSize: null,
    })
  })
})

describe("marketplace eligibility", () => {
  const enjoei = { id: "m1", name: "enjoei", supportedLanguages: ["pt-BR"] }
  const other = { id: "m2", name: "other-shop", supportedLanguages: ["en-US", "pt-BR"] }

  it("selects catalog rows that declare supported languages", () => {
    expect(selectEligibleMarketplaces([enjoei])).toEqual([enjoei])
    expect(selectEligibleMarketplaces([enjoei, other])).toEqual([enjoei, other])
  })

  it("round-robins marketplaces and respects the cap of 10", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ term: `t${i}` }))
    const assigned = assignMarketplacesRoundRobin(items.slice(0, MAX_SEARCH_TERMS), [
      enjoei,
      other,
    ])
    expect(assigned).toHaveLength(10)
    expect(assigned.map((a) => a.marketplace)).toEqual([
      "enjoei",
      "other-shop",
      "enjoei",
      "other-shop",
      "enjoei",
      "other-shop",
      "enjoei",
      "other-shop",
      "enjoei",
      "other-shop",
    ])
  })
})

describe("resolveSearchTermsLocale", () => {
  const enjoei = { id: "m1", name: "enjoei", supportedLanguages: ["pt-BR"] }
  const bilingual = { id: "m2", name: "shop", supportedLanguages: ["pt-BR", "es-PE"] }

  it("uses the user locale when the marketplace supports it", () => {
    expect(resolveSearchTermsLocale("es-PE", [bilingual])).toBe("es-PE")
    expect(resolveSearchTermsLocale("pt-BR", [enjoei])).toBe("pt-BR")
  })

  it("uses a marketplace language when the user locale is not supported", () => {
    expect(resolveSearchTermsLocale("es-PE", [enjoei])).toBe("pt-BR")
    expect(resolveSearchTermsLocale("en-US", [enjoei])).toBe("pt-BR")
  })
})

describe("parseSearchTermsLlmOutput", () => {
  it("parses term + sizeCategory and caps at 10", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      term: `term ${i}`,
      sizeCategory: "top",
    }))
    const parsed = parseSearchTermsLlmOutput(JSON.stringify(items))
    expect(parsed).toHaveLength(10)
    expect(parsed[0]).toEqual({ term: "term 0", sizeCategory: "top" })
  })
})
