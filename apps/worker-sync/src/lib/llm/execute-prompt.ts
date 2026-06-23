import { getWriteDb } from "../db/client"
import { SqlLlmInteractionsRepository } from "../db/llm-interactions.repository"
import { getLlmProvider } from "./index"
import { createLogger } from "../logger"

export interface ExecutePromptInput {
  userId: string
  prompt: string
  step: string
}

export interface ExecutePromptResult {
  response: string
}

/**
 * Sends a single prompt to the configured LLM and logs the interaction.
 * Each translation flow builds its own prompt and calls this step once.
 */
export async function executePromptStep(
  input: ExecutePromptInput,
): Promise<ExecutePromptResult> {
  const log = createLogger(input.step, input.userId)
  log.info("Step started", { promptLength: input.prompt.length })

  const llm = getLlmProvider()
  const logRepo = new SqlLlmInteractionsRepository(getWriteDb())

  const startedAt = Date.now()
  let rawResponse: string

  try {
    rawResponse = await llm.generate(input.prompt)
    const latencyMs = Date.now() - startedAt
    log.info("LLM responded", {
      model: llm.name,
      latencyMs,
      responseLength: rawResponse.length,
    })

    await logRepo.log({
      userId: input.userId,
      model: llm.name,
      prompt: input.prompt,
      response: rawResponse,
      status: "SUCCESS",
      latencyMs,
    })

    return { response: rawResponse }
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    log.error("LLM call failed", {
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    })
    await safeLog(log, logRepo, {
      userId: input.userId,
      model: llm.name,
      prompt: input.prompt,
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs,
    })
    throw err
  }
}

interface LogInput {
  userId: string
  model: string
  prompt: string
  status: "ERROR"
  errorMessage: string
  latencyMs: number
}

async function safeLog(
  log: ReturnType<typeof createLogger>,
  repo: SqlLlmInteractionsRepository,
  input: LogInput,
): Promise<void> {
  try {
    await repo.log(input)
    log.debug("LLM interaction logged", { status: input.status })
  } catch (err) {
    log.warn("Failed to log LLM interaction — continuing", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
