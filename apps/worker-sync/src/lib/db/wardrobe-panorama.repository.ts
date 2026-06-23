import type postgres from "postgres"

export interface TranslatableWardrobePanorama {
  id: string
  content: string
}

const CREATED_BY = "worker-sync"

export class SqlWardrobePanoramaSyncRepository {
  constructor(
    private readonly readDb: postgres.Sql,
    private readonly writeDb: postgres.Sql,
  ) {}

  async findTranslatableByUserId(userId: string): Promise<TranslatableWardrobePanorama | null> {
    const rows = await this.readDb<TranslatableWardrobePanorama[]>`
      SELECT id, content
      FROM wardrobe_panorama
      WHERE user_id = ${userId}
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async updateContent(id: string, content: string): Promise<void> {
    const now = new Date()
    await this.writeDb`
      UPDATE wardrobe_panorama
      SET
        content = ${content},
        updated_at = ${now},
        updated_by = ${CREATED_BY}
      WHERE id = ${id}
    `
  }
}
