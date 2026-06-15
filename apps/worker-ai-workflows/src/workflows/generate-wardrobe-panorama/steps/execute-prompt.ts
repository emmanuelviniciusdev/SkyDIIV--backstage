import { getWriteDb } from "../../../lib/db/client"
import { SqlLlmInteractionsRepository } from "../../../lib/db/llm-interactions.repository"
import { getLlmProvider } from "../../../lib/llm"
import { createLogger } from "../../../lib/logger"

export interface ExecutePromptInput {
  userId: string
  prompt: string
}

export interface ExecutePromptResult {
  llmInteractionId: string
  response: string
}

export async function executePromptStep(
  input: ExecutePromptInput,
): Promise<ExecutePromptResult> {
  const log = createLogger("execute-prompt-panorama", input.userId)
  log.info("Step started", { promptLength: input.prompt.length })

  const llm = getLlmProvider()
  const logRepo = new SqlLlmInteractionsRepository(getWriteDb())

  log.info("Calling LLM", { model: llm.name })
  const startedAt = Date.now()
  let rawResponse: string

  try {
    rawResponse = await llm.generate(input.prompt)
    const latencyMs = Date.now() - startedAt
    log.info("LLM responded", { latencyMs, responseLength: rawResponse.length })

    const llmInteractionId = await logRepo.logAndReturnId({
      userId: input.userId,
      model: llm.name,
      prompt: input.prompt,
      response: rawResponse,
      status: "SUCCESS",
      latencyMs,
    })

    return { llmInteractionId, response: rawResponse }
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

// ---------------------------------------------------------------------------

interface LogInput {
  userId: string
  model: string
  prompt: string
  response?: string
  status: "SUCCESS" | "ERROR"
  errorMessage?: string
  latencyMs: number
}

/** LLM interaction logging must never crash the workflow. */
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
