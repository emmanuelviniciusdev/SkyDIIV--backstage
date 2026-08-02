import { describe, it, expect } from "vitest"
import {
  parseWardrobePanoramaResponse,
  MAX_SHOPPING_SUGGESTIONS,
} from "../../src/lib/prompt/panorama-response"

const FENCE_OPEN = String.fromCharCode(96, 96, 96) // ```
const VALID_JSON = [
  "[",
  '  { "searchTerm": "blazer casual bege", "brand": null, "sizeCategory": "top" },',
  '  { "searchTerm": "tenis branco minimalista", "brand": "Nike", "sizeCategory": "foot" }',
  "]",
].join("\n")

const VALID_MARKDOWN = [
  "## equilibrio do guarda-roupa",
  "Texto.",
  "",
  "## seu estilo",
  "Estilo classico.",
  "",
  "## o que vale buscar",
  "Vale buscar um blazer e um tenis.",
].join("\n")

function withFence(markdown: string, json: string, language = "json"): string {
  const lang = language ? language : ""
  return `${markdown}\n\n${FENCE_OPEN}${lang}\n${json}\n${FENCE_OPEN}`
}

describe("parseWardrobePanoramaResponse()", () => {
  it("splits markdown content from the trailing JSON suggestions", () => {
    const result = parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, VALID_JSON))

    expect(result.content).toBe(VALID_MARKDOWN)
    expect(result.suggestions).toEqual([
      { searchTerm: "blazer casual bege", brand: null, sizeCategory: "top" },
      { searchTerm: "tenis branco minimalista", brand: "Nike", sizeCategory: "foot" },
    ])
  })

  it("accepts a bare fence without the json language tag", () => {
    const raw = withFence(VALID_MARKDOWN, VALID_JSON, "")
    const result = parseWardrobePanoramaResponse(raw)
    expect(result.suggestions).toHaveLength(2)
  })

  it("rejects responses without a trailing JSON fence", () => {
    expect(() => parseWardrobePanoramaResponse(VALID_MARKDOWN)).toThrow(/missing a trailing/)
  })

  it("rejects empty markdown before the JSON fence", () => {
    expect(() => parseWardrobePanoramaResponse(withFence("", VALID_JSON))).toThrow(/empty markdown/)
  })

  it("rejects invalid JSON", () => {
    expect(() => parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, "{not-json}"))).toThrow(
      /not valid JSON/,
    )
  })

  it("rejects arrays with fewer than 2 suggestions", () => {
    const json = '[{ "searchTerm": "a", "brand": null, "sizeCategory": "none" }]'
    expect(() => parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, json))).toThrow(
      /expected schema/,
    )
  })

  it(`rejects arrays with more than ${MAX_SHOPPING_SUGGESTIONS} suggestions`, () => {
    const items = Array.from({ length: MAX_SHOPPING_SUGGESTIONS + 1 }, (_, i) => ({
      searchTerm: `term-${i}`,
      brand: null,
      sizeCategory: "none",
    }))
    expect(() =>
      parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, JSON.stringify(items))),
    ).toThrow(/expected schema/)
  })

  it("rejects invalid sizeCategory values", () => {
    const json = [
      "[",
      '  { "searchTerm": "a", "brand": null, "sizeCategory": "hat" },',
      '  { "searchTerm": "b", "brand": null, "sizeCategory": "top" }',
      "]",
    ].join("\n")
    expect(() => parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, json))).toThrow(
      /expected schema/,
    )
  })
})
