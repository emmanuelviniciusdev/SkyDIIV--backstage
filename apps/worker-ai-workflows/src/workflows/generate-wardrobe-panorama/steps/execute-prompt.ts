import { getWriteDb } from "../../../lib/db/client"
import { SqlLlmInteractionsRepository } from "../../../lib/db/llm-interactions.repository"
import { getLlmProvider } from "../../../lib/llm"
import { parseWardrobePanoramaResponse } from "../../../lib/prompt/panorama-response"
import { createLogger } from "../../../lib/logger"

export interface ExecutePromptInput {
  userId: string
  prompt: string
}

export interface ExecutePromptResult {
  llmInteractionId: string
  /** Markdown panorama without a trailing shopping-suggestions JSON fence. */
  content: string
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

  const latencyMs = Date.now() - startedAt

  let parsed: ReturnType<typeof parseWardrobePanoramaResponse>
  try {
    parsed = parseWardrobePanoramaResponse(rawResponse)
    log.info("Response parsed", {
      contentLength: parsed.content.length,
    })
  } catch (err) {
    log.error("Failed to parse LLM response", {
      error: err instanceof Error ? err.message : String(err),
      rawPreview: rawResponse.slice(0, 200),
    })
    await safeLog(log, logRepo, {
      userId: input.userId,
      model: llm.name,
      prompt: input.prompt,
      response: rawResponse,
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs,
    })
    throw err
  }

  const llmInteractionId = await logRepo.logAndReturnId({
    userId: input.userId,
    model: llm.name,
    prompt: input.prompt,
    response: rawResponse,
    status: "SUCCESS",
    latencyMs,
  })

  return {
    llmInteractionId,
    content: parsed.content,
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
