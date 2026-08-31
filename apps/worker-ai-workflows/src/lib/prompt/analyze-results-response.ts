import { z } from "zod"

export const ChosenListingSchema = z.object({
  searchTermScrapedProductId: z.string().min(1),
  resultId: z.string().min(1),
})

const ChosenListingsSchema = z.array(ChosenListingSchema)

export interface ChosenListing {
  searchTermScrapedProductId: string
  resultId: string
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
}

/**
 * Parses LLM JSON: one chosen result id per search term.
 * Duplicate search terms keep the first choice.
 */
export function parseAnalyzeResultsLlmOutput(raw: string): ChosenListing[] {
  const cleaned = stripMarkdownFences(raw.trim())

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`LLM response is not valid JSON:\n${cleaned.slice(0, 300)}`)
  }

  const result = ChosenListingsSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`LLM response does not match expected schema: ${result.error.message}`)
  }

  const seen = new Set<string>()
  const unique: ChosenListing[] = []
  for (const item of result.data) {
    if (seen.has(item.searchTermScrapedProductId)) continue
    seen.add(item.searchTermScrapedProductId)
    unique.push(item)
  }
  return unique
}
