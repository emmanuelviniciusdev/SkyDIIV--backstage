import { z } from "zod"
import type { ShoppingSuggestionsPreferences } from "../db/shopping-suggestions-preferences.repository"
import type { ParsedSearchTermSuggestion } from "./suggestions"

/** json_search persisted on search_terms_scraped_products. */
export const JsonSearchSchema = z.object({
  term: z.string().min(1),
  gender: z.string().nullable(),
  topSize: z.string().nullable(),
  bottomSize: z.string().nullable(),
  footSize: z.string().nullable(),
})

export type JsonSearch = z.infer<typeof JsonSearchSchema>

/**
 * Merges LLM search-term suggestions with the user's size/gender preferences.
 * Missing preferences → gender and all sizes null (term still published).
 */
export function composeSearchParams(
  suggestions: ParsedSearchTermSuggestion[],
  prefs: ShoppingSuggestionsPreferences | null,
): JsonSearch[] {
  const gender = prefs?.gender ?? null

  return suggestions.map((s) => {
    const base: JsonSearch = {
      term: s.term,
      gender,
      topSize: null,
      bottomSize: null,
      footSize: null,
    }

    switch (s.sizeCategory) {
      case "top":
        return { ...base, topSize: prefs?.topSize ?? null }
      case "bottom":
        return { ...base, bottomSize: prefs?.bottomSize ?? null }
      case "foot":
        return { ...base, footSize: prefs?.footSize ?? null }
      case "none":
        return base
    }
  })
}
