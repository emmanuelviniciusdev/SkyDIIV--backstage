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

const CREATED_BY = "worker-sync"

export class SqlLlmInteractionsRepository {
  constructor(private readonly db: postgres.Sql) {}

  async log(input: LogLlmInteractionInput): Promise<void> {
    const now = new Date()
    const recordId = randomUUID()
    const sealed = await sealListedFields({
      model: "LlmInteraction",
      rowId: recordId,
      values: {
        prompt: input.prompt,
        clientPrompt: null,
        response: input.response ?? null,
        createdBy: CREATED_BY,
        updatedBy: CREATED_BY,
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
        ${sealed.values.createdBy}, ${sealed.values.updatedBy}, ${now}, ${now}
      )
    `
  }
}
