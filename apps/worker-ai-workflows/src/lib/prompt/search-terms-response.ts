import { z } from "zod"
import { MAX_SEARCH_TERMS, SIZE_CATEGORIES, type ParsedSearchTermSuggestion } from "../shopping/suggestions"

const LlmSearchTermSchema = z.object({
  term: z.string().min(1),
  sizeCategory: z.enum(SIZE_CATEGORIES),
})

const LlmSearchTermsSchema = z.array(LlmSearchTermSchema)

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
}

/**
 * Parses LLM JSON into search-term suggestions and caps at MAX_SEARCH_TERMS.
 */
export function parseSearchTermsLlmOutput(raw: string): ParsedSearchTermSuggestion[] {
  const cleaned = stripMarkdownFences(raw.trim())

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`LLM response is not valid JSON:\n${cleaned.slice(0, 300)}`)
  }

  const result = LlmSearchTermsSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`LLM response does not match expected schema: ${result.error.message}`)
  }

  return result.data.slice(0, MAX_SEARCH_TERMS).map((item) => ({
    term: item.term.trim(),
    sizeCategory: item.sizeCategory,
  })).filter((item) => item.term.length > 0)
}
