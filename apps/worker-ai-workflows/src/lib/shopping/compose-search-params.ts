import type { ShoppingSuggestionsPreferences } from "../db/shopping-suggestions-preferences.repository"
import type { ParsedShoppingSuggestion } from "../prompt/panorama-response"

/** Wire shape matching robot-shopping-suggestions scrape payload searchParams. */
export interface ScrapeSearchParams {
  searchTerm: string
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
  brand: string | null
}

/**
 * Merges LLM shopping suggestions with the user's size/gender preferences.
 * Missing preferences → gender and all sizes null (searchTerm + brand still published).
 */
export function composeSearchParams(
  suggestions: ParsedShoppingSuggestion[],
  prefs: ShoppingSuggestionsPreferences | null,
): ScrapeSearchParams[] {
  const gender = prefs?.gender ?? null

  return suggestions.map((s) => {
    const base: ScrapeSearchParams = {
      searchTerm: s.searchTerm,
      gender,
      topSize: null,
      bottomSize: null,
      footSize: null,
      brand: s.brand,
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
