import { randomUUID } from "node:crypto"
import type postgres from "postgres"
import type { JsonResult } from "./json-search.js"
import { MAX_RESULTS_PER_TERM } from "./json-search.js"

const CREATED_BY = "robot-scrape-products"

export class SqlSearchResultsRepository {
  constructor(private readonly writeDb: postgres.Sql) {}

  /**
   * Inserts at most 10 result rows for a search term and marks the term processed.
   * An empty listings list still marks the term processed.
   */
  async insertResultsAndMarkProcessed(input: {
    searchTermId: string
    results: JsonResult[]
  }): Promise<void> {
    const now = new Date()
    const capped = input.results.slice(0, MAX_RESULTS_PER_TERM)

    await this.writeDb.begin(async (tx) => {
      for (const result of capped) {
        await tx`
          INSERT INTO results_search_terms_scraped_products (
            id,
            search_term_scraped_product_id,
            json_result,
            is_processed,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            ${randomUUID()},
            ${input.searchTermId},
            ${tx.json(result)},
            ${false},
            ${CREATED_BY},
            ${CREATED_BY},
            ${now},
            ${now}
          )
        `
      }

      await tx`
        UPDATE search_terms_scraped_products
        SET is_processed = true,
            updated_at = ${now},
            updated_by = ${CREATED_BY}
        WHERE id = ${input.searchTermId}
      `
    })
  }
}
