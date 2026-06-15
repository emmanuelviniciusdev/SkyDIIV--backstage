import { getWriteDb } from "../../../lib/db/client"
import { SqlLlmInteractionsRepository } from "../../../lib/db/llm-interactions.repository"
import { getLlmProvider } from "../../../lib/llm"
import { parseOutfitSuggestions } from "../../../lib/prompt/builder"
import { createLogger } from "../../../lib/logger"
import type { ParsedOutfitSuggestion } from "../../../lib/prompt/builder"

export interface ExecutePromptInput {
  userId: string
  prompt: string
}

/**
 * Step 2 — Sends the assembled prompt to the configured LLM and parses the
 * structured JSON response into outfit suggestions.
 *
 * The interaction (prompt, response, latency, status) is logged to the
 * llm_interactions table regardless of success or failure.
 */
export async function executePromptStep(
  input: ExecutePromptInput,
): Promise<ParsedOutfitSuggestion[]> {
  const log = createLogger("execute-prompt", input.userId)
  log.info("Step started", { promptLength: input.prompt.length })

  const llm = getLlmProvider()
  const logRepo = new SqlLlmInteractionsRepository(getWriteDb())

  log.info("Calling LLM", { model: llm.name })
  const startedAt = Date.now()
  let rawResponse: string | undefined

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

  log.debug("Parsing LLM response")
  let suggestions: ParsedOutfitSuggestion[]
  try {
    suggestions = parseOutfitSuggestions(rawResponse)
    log.info("Response parsed", { suggestionCount: suggestions.length })
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

  await safeLog(log, logRepo, {
    userId: input.userId,
    model: llm.name,
    prompt: input.prompt,
    response: rawResponse,
    status: "SUCCESS",
    latencyMs,
  })

  log.info("Step completed", { suggestionCount: suggestions.length })
  return suggestions
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
