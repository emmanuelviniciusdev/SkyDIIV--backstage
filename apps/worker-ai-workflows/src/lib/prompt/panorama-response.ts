import { z } from "zod"

export const SIZE_CATEGORIES = ["top", "bottom", "foot", "none"] as const
export type SizeCategory = (typeof SIZE_CATEGORIES)[number]

export const MAX_SHOPPING_SUGGESTIONS = 5
export const MIN_SHOPPING_SUGGESTIONS = 2

const ShoppingSuggestionSchema = z.object({
  searchTerm: z.string().min(1),
  brand: z.string().min(1).nullable(),
  sizeCategory: z.enum(SIZE_CATEGORIES),
})

const ShoppingSuggestionsSchema = z
  .array(ShoppingSuggestionSchema)
  .min(MIN_SHOPPING_SUGGESTIONS)
  .max(MAX_SHOPPING_SUGGESTIONS)

export interface ParsedShoppingSuggestion {
  searchTerm: string
  brand: string | null
  sizeCategory: SizeCategory
}

export interface ParsedWardrobePanoramaResponse {
  /** Markdown panorama without the trailing JSON fence. */
  content: string
  suggestions: ParsedShoppingSuggestion[]
}

const JSON_FENCE_RE = new RegExp("```(?:json)?\\s*([\\s\\S]*?)\\s*```\\s*$", "i")

/**
 * Splits the LLM response into markdown panorama + structured shopping suggestions.
 * Expects a trailing fenced JSON block with 2-5 suggestion objects.
 */
export function parseWardrobePanoramaResponse(raw: string): ParsedWardrobePanoramaResponse {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(JSON_FENCE_RE)
  if (!fenceMatch || fenceMatch.index === undefined) {
    throw new Error(
      "LLM response is missing a trailing json shopping-suggestions block",
    )
  }

  const content = trimmed.slice(0, fenceMatch.index).trim()
  if (!content) {
    throw new Error("LLM response has an empty markdown panorama before the JSON block")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fenceMatch[1].trim())
  } catch {
    throw new Error(
      `Shopping suggestions JSON is not valid JSON:\n${fenceMatch[1].trim().slice(0, 300)}`,
    )
  }

  const result = ShoppingSuggestionsSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Shopping suggestions do not match expected schema: ${result.error.message}`,
    )
  }

  return {
    content,
    suggestions: result.data.map((s) => ({
      searchTerm: s.searchTerm.trim(),
      brand: s.brand,
      sizeCategory: s.sizeCategory,
    })),
  }
}
