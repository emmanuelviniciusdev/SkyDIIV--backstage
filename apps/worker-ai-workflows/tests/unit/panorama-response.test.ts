import { describe, it, expect } from "vitest"
import { parseWardrobePanoramaResponse } from "../../src/lib/prompt/panorama-response"

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
  it("returns markdown-only output without a JSON fence", () => {
    const result = parseWardrobePanoramaResponse(VALID_MARKDOWN)
    expect(result.content).toBe(VALID_MARKDOWN)
  })

  it("strips a leftover trailing JSON fence so only markdown is persisted", () => {
    const result = parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, VALID_JSON))
    expect(result.content).toBe(VALID_MARKDOWN)
    expect(result.content).not.toContain("searchTerm")
  })

  it("strips a bare fence without the json language tag", () => {
    const result = parseWardrobePanoramaResponse(withFence(VALID_MARKDOWN, VALID_JSON, ""))
    expect(result.content).toBe(VALID_MARKDOWN)
  })

  it("rejects an empty response", () => {
    expect(() => parseWardrobePanoramaResponse("   ")).toThrow(/empty/)
  })

  it("rejects empty markdown before a leftover JSON fence", () => {
    expect(() => parseWardrobePanoramaResponse(withFence("", VALID_JSON))).toThrow(/empty markdown/)
  })
})
