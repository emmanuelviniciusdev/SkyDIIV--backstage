import type { SearchParams } from "../../domain/entities/search-params.js"
import type { JsonSearch } from "../db/json-search.js"

export function jsonSearchToSearchParams(jsonSearch: JsonSearch): SearchParams {
  return {
    searchTerm: jsonSearch.term,
    gender: jsonSearch.gender,
    topSize: jsonSearch.topSize,
    bottomSize: jsonSearch.bottomSize,
    footSize: jsonSearch.footSize,
    brand: null,
  }
}
