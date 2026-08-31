/**
 * Search criteria for a marketplace scrape.
 *
 * `searchTerm` is the free-text query. Optional gender/size/brand filters map to
 * marketplace advanced filters (e.g. Enjoei department + size/brand URL params).
 */
export interface SearchParams {
  searchTerm: string
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
  brand: string | null
}

/** JSON-safe copy of SearchParams for persistence (e.g. scraping_metadata). */
export type SearchParamsJson = SearchParams & {
  [key: string]: string | null
}

/** Builds a plain object suitable for JSONB / postgres JSONValue. */
export function toSearchParamsJson(params: SearchParams): SearchParamsJson {
  return {
    searchTerm: params.searchTerm,
    gender: params.gender,
    topSize: params.topSize,
    bottomSize: params.bottomSize,
    footSize: params.footSize,
    brand: params.brand,
  }
}
