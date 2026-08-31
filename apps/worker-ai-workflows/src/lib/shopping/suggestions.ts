export const SIZE_CATEGORIES = ["top", "bottom", "foot", "none"] as const
export type SizeCategory = (typeof SIZE_CATEGORIES)[number]

export const MAX_SEARCH_TERMS = 10

export interface ParsedSearchTermSuggestion {
  term: string
  sizeCategory: SizeCategory
}
