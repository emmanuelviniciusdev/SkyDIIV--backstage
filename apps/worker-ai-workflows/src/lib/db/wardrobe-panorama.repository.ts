import { randomUUID } from "crypto"
import type postgres from "postgres"
import { createListedRowOpener, sealListedFields } from "../field-encryption/open-seal"
import { createLogger } from "../logger"

const CREATED_BY = "worker-ai-workflows"

export interface SavePanoramaInput {
  userId: string
  llmInteractionId?: string | null
  content: string
}

export interface WardrobePanoramaRecord {
  id: string
  userId: string
  content: string
}

interface WardrobePanoramaRow {
  id: string
  user_id: string
  content: string
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
}

export class SqlWardrobePanoramaRepository {
  constructor(private readonly writeDb: postgres.Sql, private readonly readDb?: postgres.Sql) {}

  async findById(id: string): Promise<WardrobePanoramaRecord | null> {
    const reader = this.readDb ?? this.writeDb
    const rows = await reader<WardrobePanoramaRow[]>`
      SELECT id, user_id, content, dek, kek_version, encrypted_columns
      FROM wardrobe_panorama
      WHERE id = ${id}
      LIMIT 1
    `
    if (rows.length === 0) return null
    const row = rows[0]
    const open = createListedRowOpener()
    const opened = await open({
      model: "WardrobePanorama",
      rowId: row.id,
      values: { content: row.content },
      dek: row.dek,
      kekVersion: row.kek_version,
      encryptedColumns: row.encrypted_columns,
    })
    return { id: row.id, userId: row.user_id, content: opened.content ?? "" }
  }

  async saveOrUpdate(input: SavePanoramaInput): Promise<void> {
    const log = createLogger("wardrobe-panorama-repo", input.userId)
    const now = new Date()

    // Attempt to read using the provided readDb if available, otherwise use writeDb
    const reader = this.readDb ?? this.writeDb
    const existing = await reader<WardrobePanoramaRow[]>`
      SELECT id, user_id, content, dek, kek_version, encrypted_columns
      FROM wardrobe_panorama
      WHERE user_id = ${input.userId}
      LIMIT 1
    `

    if (existing.length === 0) {
      const id = randomUUID()
      const sealed = await sealListedFields({
        model: "WardrobePanorama",
        rowId: id,
        values: { content: input.content },
      })
      await this.writeDb`
        INSERT INTO wardrobe_panorama (
          id, user_id, llm_interaction_id, content, dek, kek_version, encrypted_columns,
          generated_at, created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${id}, ${input.userId}, ${input.llmInteractionId ?? null}, ${sealed.values.content},
          ${sealed.dek}, ${sealed.kekVersion}, ${sealed.encryptedColumns},
          ${now}, ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
        )
      `
      log.info("Inserted wardrobe panorama", { id })
    } else {
      const row = existing[0]
      const open = createListedRowOpener()
      await open({
        model: "WardrobePanorama",
        rowId: row.id,
        values: { content: row.content },
        dek: row.dek,
        kekVersion: row.kek_version,
        encryptedColumns: row.encrypted_columns,
      })
      const sealed = await sealListedFields({
        model: "WardrobePanorama",
        rowId: row.id,
        values: { content: input.content },
      })
      await this.writeDb`
        UPDATE wardrobe_panorama
        SET llm_interaction_id = ${input.llmInteractionId ?? null},
            content = ${sealed.values.content},
            dek = ${sealed.dek},
            kek_version = ${sealed.kekVersion},
            encrypted_columns = ${sealed.encryptedColumns},
            generated_at = ${now},
            updated_at = ${now},
            updated_by = ${CREATED_BY}
        WHERE id = ${row.id}
      `
      log.info("Updated wardrobe panorama", { id: row.id })
    }
  }
}
