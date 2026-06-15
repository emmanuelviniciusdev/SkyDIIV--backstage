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

const CREATED_BY = "worker-ai-workflows"

export class SqlLlmInteractionsRepository {
  constructor(private readonly db: postgres.Sql) {}

  /** Inserts an LLM interaction record and returns its id. */
  async logAndReturnId(input: LogLlmInteractionInput, id?: string): Promise<string> {
    const now = new Date()
    const recordId = id ?? randomUUID()
    await this.db`
      INSERT INTO llm_interactions (
        id, user_id, model, prompt, response, status,
        error_message, latency_ms,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${recordId},
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
    return recordId
  }

  /** Backwards-compatible: keep existing `log` that doesn't return the id. */
  async log(input: LogLlmInteractionInput): Promise<void> {
    await this.logAndReturnId(input)
  }
}
