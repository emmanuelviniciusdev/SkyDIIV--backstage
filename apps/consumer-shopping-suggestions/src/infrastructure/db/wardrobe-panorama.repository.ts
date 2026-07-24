import type postgres from "postgres"
import type { WardrobePanoramaRepositoryPort } from "../../domain/ports/wardrobe-panorama.repository.port.js"

export class SqlWardrobePanoramaRepository implements WardrobePanoramaRepositoryPort {
  constructor(private readonly readDb: postgres.Sql) {}

  async findIdByUserId(userId: string): Promise<string | null> {
    const rows = await this.readDb<{ id: string }[]>`
      SELECT id
      FROM wardrobe_panorama
      WHERE user_id = ${userId}
      LIMIT 1
    `
    return rows[0]?.id ?? null
  }
}
