import { randomUUID } from "node:crypto"
import type postgres from "postgres"
import type {
  ReplaceScrapedProductsInput,
  ScrapedProductsRepositoryPort,
} from "../../domain/ports/scraped-products.repository.port.js"
import type { Logger } from "../../domain/ports/logger.port.js"

const CREATED_BY = "consumer-shopping-suggestions"

export class SqlScrapedProductsRepository implements ScrapedProductsRepositoryPort {
  constructor(
    private readonly readDb: postgres.Sql,
    private readonly writeDb: postgres.Sql,
    private readonly logger: Logger,
  ) {}

  async findClothingItemProductTypeId(): Promise<string> {
    const rows = await this.readDb<{ id: string }[]>`
      SELECT id
      FROM domains
      WHERE type = 'product_type'
        AND source = 'scraped_products'
        AND name = 'Clothing Item'
      LIMIT 1
    `

    const id = rows[0]?.id
    if (!id) {
      throw new Error(
        'Domain product_type "Clothing Item" (source=scraped_products) was not found',
      )
    }
    return id
  }

  async replaceForPanorama(input: ReplaceScrapedProductsInput): Promise<void> {
    const { wardrobePanoramaId, productTypeId, products } = input
    const now = new Date()

    await this.writeDb.begin(async (tx) => {
      const deleted = await tx`
        DELETE FROM scraped_products
        WHERE wardrobe_panorama_id = ${wardrobePanoramaId}
      `
      this.logger.info("Deleted existing scraped products", {
        wardrobePanoramaId,
        deletedCount: deleted.count,
      })

      for (const product of products) {
        await tx`
          INSERT INTO scraped_products (
            id,
            wardrobe_panorama_id,
            product_type_id,
            marketplace,
            title,
            price,
            currency,
            url,
            image_url,
            search_term,
            scraping_status,
            scraping_metadata,
            created_by,
            updated_by,
            created_at,
            updated_at
          ) VALUES (
            ${randomUUID()},
            ${wardrobePanoramaId},
            ${productTypeId},
            ${product.marketplace},
            ${product.title},
            ${product.price},
            ${product.currency},
            ${product.url},
            ${product.imageUrl},
            ${product.searchTerm},
            ${product.scrapingStatus}::"ScrapedProductScrapingStatus",
            ${tx.json(product.scrapingMetadata)},
            ${CREATED_BY},
            ${CREATED_BY},
            ${now},
            ${now}
          )
        `
      }

      this.logger.info("Inserted scraped products", {
        wardrobePanoramaId,
        insertedCount: products.length,
      })
    })
  }
}
