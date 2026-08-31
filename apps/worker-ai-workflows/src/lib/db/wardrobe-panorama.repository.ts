import { randomUUID } from "crypto"
import type postgres from "postgres"
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
}

export class SqlWardrobePanoramaRepository {
  constructor(private readonly writeDb: postgres.Sql, private readonly readDb?: postgres.Sql) {}

  async findById(id: string): Promise<WardrobePanoramaRecord | null> {
    const reader = this.readDb ?? this.writeDb
    const rows = await reader<WardrobePanoramaRow[]>`
      SELECT id, user_id, content
      FROM wardrobe_panorama
      WHERE id = ${id}
      LIMIT 1
    `
    if (rows.length === 0) return null
    const row = rows[0]
    return { id: row.id, userId: row.user_id, content: row.content }
  }

  async saveOrUpdate(input: SavePanoramaInput): Promise<void> {
    const log = createLogger("wardrobe-panorama-repo", input.userId)
    const now = new Date()

    // Attempt to read using the provided readDb if available, otherwise use writeDb
    const reader = this.readDb ?? this.writeDb
    const existing = await reader<{ id: string }[]>`
      SELECT id FROM wardrobe_panorama WHERE user_id = ${input.userId} LIMIT 1
    `

    if (existing.length === 0) {
      const id = randomUUID()
      await this.writeDb`
        INSERT INTO wardrobe_panorama (
          id, user_id, llm_interaction_id, content, generated_at,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${id}, ${input.userId}, ${input.llmInteractionId ?? null}, ${input.content},
          ${now}, ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
        )
      `
      log.info("Inserted wardrobe panorama", { id })
    } else {
      const id = existing[0].id
      await this.writeDb`
        UPDATE wardrobe_panorama
        SET llm_interaction_id = ${input.llmInteractionId ?? null},
            content = ${input.content},
            generated_at = ${now},
            updated_at = ${now},
            updated_by = ${CREATED_BY}
        WHERE id = ${id}
      `
      log.info("Updated wardrobe panorama", { id })
    }
  }
}
