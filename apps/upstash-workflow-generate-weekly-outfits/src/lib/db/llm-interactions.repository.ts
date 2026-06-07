import { randomUUID } from "crypto"
import type postgres from "postgres"

export interface LogLlmInteractionInput {
  userId: string
  model: string
  prompt: string
  response?: string
  status: "SUCCESS" | "ERROR"
  errorMessage?: string
  latencyMs: number
}

const CREATED_BY = "upstash-workflow-generate-weekly-outfits"

export class SqlLlmInteractionsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async log(input: LogLlmInteractionInput): Promise<void> {
    const now = new Date()
    await this.db`
      INSERT INTO llm_interactions (
        id, user_id, model, prompt, response, status,
        error_message, latency_ms,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${randomUUID()},
        ${input.userId},
        ${input.model},
        ${input.prompt},
        ${input.response ?? null},
        ${input.status},
        ${input.errorMessage ?? null},
        ${input.latencyMs},
        ${CREATED_BY}, ${CREATED_BY}, ${now}, ${now}
      )
    `
  }
}
