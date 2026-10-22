import { randomUUID } from "crypto"
import type postgres from "postgres"
import { sealListedFields } from "../field-encryption/open-seal"

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
    const sealed = await sealListedFields({
      model: "LlmInteraction",
      rowId: recordId,
      values: {
        prompt: input.prompt,
        clientPrompt: null,
        response: input.response ?? null,
      },
    })
    await this.db`
      INSERT INTO llm_interactions (
        id, user_id, model, prompt, client_prompt, response, status,
        error_message, latency_ms, dek, kek_version, encrypted_columns,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${recordId},
        ${input.userId},
        ${input.model},
        ${sealed.values.prompt},
        ${null},
        ${sealed.values.response ?? null},
        ${input.status},
        ${input.errorMessage ?? null},
        ${input.latencyMs},
        ${sealed.dek},
        ${sealed.kekVersion},
        ${sealed.encryptedColumns},
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
