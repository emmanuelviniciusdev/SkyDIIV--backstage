import type postgres from "postgres"
import type { JsonSearch } from "./json-search.js"

export interface UnprocessedSearchTerm {
  id: string
  wardrobePanoramaId: string
  marketplace: string
  jsonSearch: JsonSearch
}

export interface SearchTermGroup {
  wardrobePanoramaId: string
  terms: UnprocessedSearchTerm[]
}

interface SearchTermRow {
  id: string
  wardrobe_panorama_id: string
  marketplace: string
  json_search: unknown
}

function asJsonSearch(value: unknown): JsonSearch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { term: "", gender: null, topSize: null, bottomSize: null, footSize: null }
  }
  const record = value as Record<string, unknown>
  return {
    term: typeof record.term === "string" ? record.term : "",
    gender: typeof record.gender === "string" ? record.gender : null,
    topSize: typeof record.topSize === "string" ? record.topSize : null,
    bottomSize: typeof record.bottomSize === "string" ? record.bottomSize : null,
    footSize: typeof record.footSize === "string" ? record.footSize : null,
  }
}

export class SqlSearchTermsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findUnprocessedGroupedByPanorama(): Promise<SearchTermGroup[]> {
    const rows = await this.db<SearchTermRow[]>`
      SELECT id, wardrobe_panorama_id, marketplace, json_search
      FROM search_terms_scraped_products
      WHERE is_processed = false
      ORDER BY wardrobe_panorama_id, created_at ASC
    `

    const groups = new Map<string, UnprocessedSearchTerm[]>()
    for (const row of rows) {
      const term: UnprocessedSearchTerm = {
        id: row.id,
        wardrobePanoramaId: row.wardrobe_panorama_id,
        marketplace: row.marketplace,
        jsonSearch: asJsonSearch(row.json_search),
      }
      const list = groups.get(row.wardrobe_panorama_id) ?? []
      list.push(term)
      groups.set(row.wardrobe_panorama_id, list)
    }

    return [...groups.entries()].map(([wardrobePanoramaId, terms]) => ({
      wardrobePanoramaId,
      terms,
    }))
  }
}
