import { randomUUID } from "crypto"
import type postgres from "postgres"
import type { JsonSearch } from "../shopping/compose-search-params"

const CREATED_BY = "worker-ai-workflows"

export interface InsertSearchTermInput {
  wardrobePanoramaId: string
  llmInteractionId: string
  marketplace: string
  jsonSearch: JsonSearch
}

export interface SearchTermsScrapedProductsRepository {
  existsUnprocessedForPanorama(wardrobePanoramaId: string): Promise<boolean>
  insertMany(rows: InsertSearchTermInput[]): Promise<void>
}

export class SqlSearchTermsScrapedProductsRepository
  implements SearchTermsScrapedProductsRepository
{
  constructor(private readonly db: postgres.Sql) {}

  async existsUnprocessedForPanorama(wardrobePanoramaId: string): Promise<boolean> {
    const rows = await this.db<{ has_unprocessed: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM search_terms_scraped_products
        WHERE wardrobe_panorama_id = ${wardrobePanoramaId}
          AND is_processed = false
      ) AS has_unprocessed
    `
    return rows[0]?.has_unprocessed === true
  }

  async insertMany(rows: InsertSearchTermInput[]): Promise<void> {
    if (rows.length === 0) return

    const now = new Date()
    for (const row of rows) {
      await this.db`
        INSERT INTO search_terms_scraped_products (
          id,
          wardrobe_panorama_id,
          llm_interaction_id,
          marketplace,
          json_search,
          is_processed,
          created_by,
          updated_by,
          created_at,
          updated_at
        ) VALUES (
          ${randomUUID()},
          ${row.wardrobePanoramaId},
          ${row.llmInteractionId},
          ${row.marketplace},
          ${this.db.json(row.jsonSearch)},
          ${false},
          ${CREATED_BY},
          ${CREATED_BY},
          ${now},
          ${now}
        )
      `
    }
  }
}
