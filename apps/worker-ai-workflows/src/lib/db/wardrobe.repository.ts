import type postgres from "postgres"

export interface WardrobeItem {
  id: string
  title: string
  tags: string[]
  imageUrl: string | null
}

export interface WardrobeRepository {
  findByUserId(userId: string): Promise<WardrobeItem[]>
}

interface WardrobeRow {
  id: string
  title: string
  image_url: string | null
  tags: string[]
}

export class SqlWardrobeRepository implements WardrobeRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<WardrobeItem[]> {
    const rows = await this.db<WardrobeRow[]>`
      SELECT
        ci.id,
        ci.title,
        ci.image_url,
        COALESCE(
          ARRAY_AGG(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL),
          '{}'::text[]
        ) AS tags
      FROM clothing_items ci
      LEFT JOIN clothing_item_tags cit ON cit.clothing_item_id = ci.id
      LEFT JOIN tags t ON t.id = cit.tag_id
      WHERE ci.user_id = ${userId}
      GROUP BY ci.id, ci.title, ci.image_url
      ORDER BY ci.created_at ASC
    `

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      tags: row.tags,
      imageUrl: row.image_url,
    }))
  }
}
