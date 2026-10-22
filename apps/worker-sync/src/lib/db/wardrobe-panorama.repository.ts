import type postgres from "postgres"
import { createListedRowOpener, sealListedFields } from "../field-encryption/open-seal"

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
    const rows = await this.readDb<PanoramaEnvelopeRow[]>`
      SELECT id, content, dek, kek_version, encrypted_columns, created_by, updated_by
      FROM wardrobe_panorama
      WHERE user_id = ${userId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const opened = await this.openContent(row)
    return { id: row.id, content: opened.content ?? "" }
  }

  async updateContent(id: string, content: string): Promise<void> {
    const rows = await this.readDb<PanoramaEnvelopeRow[]>`
      SELECT id, content, dek, kek_version, encrypted_columns, created_by, updated_by
      FROM wardrobe_panorama
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return

    const opened = await this.openContent(row)
    const sealed = await sealListedFields({
      model: "WardrobePanorama",
      rowId: row.id,
      values: {
        content,
        createdBy: opened.createdBy ?? CREATED_BY,
        updatedBy: CREATED_BY,
      },
    })
    const now = new Date()
    await this.writeDb`
      UPDATE wardrobe_panorama
      SET
        content = ${sealed.values.content},
        dek = ${sealed.dek},
        kek_version = ${sealed.kekVersion},
        encrypted_columns = ${sealed.encryptedColumns},
        updated_at = ${now},
        created_by = ${sealed.values.createdBy},
        updated_by = ${sealed.values.updatedBy}
      WHERE id = ${id}
    `
  }

  private async openContent(row: PanoramaEnvelopeRow): Promise<Record<string, string | null>> {
    const open = createListedRowOpener()
    return open({
      model: "WardrobePanorama",
      rowId: row.id,
      values: { content: row.content, createdBy: row.created_by, updatedBy: row.updated_by },
      dek: row.dek,
      kekVersion: row.kek_version,
      encryptedColumns: row.encrypted_columns,
    })
  }
}

interface PanoramaEnvelopeRow {
  id: string
  content: string
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
  created_by: string | null
  updated_by: string | null
}
