import type { SearchParams } from "../../src/domain/entities/search-params.js"

/** Shared fixture for scrape payloads / scraper inputs. */
export function searchParams(
  searchTerm: string,
  overrides?: Partial<Omit<SearchParams, "searchTerm">>,
): SearchParams {
  return {
    searchTerm,
    gender: overrides?.gender ?? null,
    topSize: overrides?.topSize ?? null,
    bottomSize: overrides?.bottomSize ?? null,
    footSize: overrides?.footSize ?? null,
    brand: overrides?.brand ?? null,
  }
}
