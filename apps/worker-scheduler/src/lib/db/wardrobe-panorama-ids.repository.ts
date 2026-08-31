import type postgres from "postgres"

export interface WardrobePanoramaIdsRepository {
  findAllIds(): Promise<string[]>
}

interface PanoramaIdRow {
  id: string
}

/**
 * Lists every wardrobe_panorama id. Friday automatic thrifting dispatches
 * all existing panoramas (no wardrobe-size or update-marker filter).
 */
export class SqlWardrobePanoramaIdsRepository implements WardrobePanoramaIdsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findAllIds(): Promise<string[]> {
    const rows = await this.db<PanoramaIdRow[]>`
      SELECT id FROM wardrobe_panorama
    `
    return rows.map((row) => row.id)
  }
}
