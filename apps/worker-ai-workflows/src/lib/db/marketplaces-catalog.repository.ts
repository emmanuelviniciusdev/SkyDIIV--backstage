import type postgres from "postgres"

export interface MarketplaceCatalogEntry {
  id: string
  name: string
  supportedLanguages: string[]
}

export interface MarketplacesCatalogRepository {
  findAll(): Promise<MarketplaceCatalogEntry[]>
}

interface MarketplaceCatalogRow {
  id: string
  name: string
  supported_languages: unknown
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v))
  return []
}

export class SqlMarketplacesCatalogRepository implements MarketplacesCatalogRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findAll(): Promise<MarketplaceCatalogEntry[]> {
    const rows = await this.db<MarketplaceCatalogRow[]>`
      SELECT id, name, supported_languages
      FROM marketplaces_catalog_scraped_products
    `

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      supportedLanguages: toStringArray(row.supported_languages),
    }))
  }
}
