import type postgres from "postgres"
import { createListedRowOpener } from "../field-encryption/open-seal"

export interface WardrobeItem {
  id: string
  title: string
  colors: string[]
  size: string | null
  imageUrl: string | null
  pieceType: string | null
  pieceSubtype: string | null
}

export interface WardrobeRepository {
  findByUserId(userId: string): Promise<WardrobeItem[]>
}

interface WardrobeRow {
  id: string
  title: string
  image_url: string | null
  colors: string[]
  piece_size: string | null
  piece_type: string | null
  piece_subtype: string | null
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
}

export class SqlWardrobeRepository implements WardrobeRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<WardrobeItem[]> {
    const rows = await this.db<WardrobeRow[]>`
      SELECT
        ci.id,
        ci.title,
        ci.image_url,
        ci.dek,
        ci.kek_version,
        ci.encrypted_columns,
        pt.name AS piece_type,
        ps.name AS piece_subtype,
        sz.name AS piece_size,
        COALESCE(
          ARRAY_AGG(pc.name ORDER BY pc.name) FILTER (WHERE pc.name IS NOT NULL),
          '{}'::text[]
        ) AS colors
      FROM clothing_items ci
      LEFT JOIN clothing_item_colors cic ON cic.clothing_item_id = ci.id
      LEFT JOIN domains pc ON pc.id = cic.color_id
      LEFT JOIN domains pt ON pt.id = ci.piece_type_id
      LEFT JOIN domains ps ON ps.id = ci.piece_subtype_id
      LEFT JOIN domains sz ON sz.id = ci.id_size
      WHERE ci.user_id = ${userId}
      GROUP BY ci.id, ci.title, ci.image_url, ci.dek, ci.kek_version, ci.encrypted_columns, pt.name, ps.name, sz.name
      ORDER BY ci.created_at ASC
    `

    const open = createListedRowOpener()
    return Promise.all(rows.map(async (row) => {
      const opened = await open({
        model: "ClothingItem",
        rowId: row.id,
        values: { imageUrl: row.image_url },
        dek: row.dek,
        kekVersion: row.kek_version,
        encryptedColumns: row.encrypted_columns,
      })
      return {
        id: row.id,
        title: row.title,
        colors: row.colors,
        size: row.piece_size,
        imageUrl: opened.imageUrl ?? null,
        pieceType: row.piece_type,
        pieceSubtype: row.piece_subtype,
      }
    }))
  }
}
