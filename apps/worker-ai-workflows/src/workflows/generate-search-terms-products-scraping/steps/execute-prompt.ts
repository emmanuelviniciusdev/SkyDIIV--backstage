import { getWriteDb } from "../../../lib/db/client"
import { SqlLlmInteractionsRepository } from "../../../lib/db/llm-interactions.repository"
import { getLlmProvider } from "../../../lib/llm"
import { parseSearchTermsLlmOutput } from "../../../lib/prompt/search-terms-response"
import type { ParsedSearchTermSuggestion } from "../../../lib/shopping/suggestions"
import { createLogger } from "../../../lib/logger"

export interface ExecuteGenerateSearchTermsPromptInput {
  userId: string
  prompt: string
}

export interface ExecuteGenerateSearchTermsPromptResult {
  llmInteractionId: string
  suggestions: ParsedSearchTermSuggestion[]
}

export async function executeGenerateSearchTermsPromptStep(
  input: ExecuteGenerateSearchTermsPromptInput,
): Promise<ExecuteGenerateSearchTermsPromptResult> {
  const log = createLogger("execute-prompt-generate-search-terms", input.userId)
  const llm = getLlmProvider()
  const logRepo = new SqlLlmInteractionsRepository(getWriteDb())

  const startedAt = Date.now()
  let rawResponse: string

  try {
    rawResponse = await llm.generate(input.prompt)
    log.info("LLM responded", {
      latencyMs: Date.now() - startedAt,
      responseLength: rawResponse.length,
    })
  } catch (err) {
    await safeLog(log, logRepo, {
      userId: input.userId,
      model: llm.name,
      prompt: input.prompt,
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    })
    throw err
  }

  const latencyMs = Date.now() - startedAt

  let suggestions: ParsedSearchTermSuggestion[]
  try {
    suggestions = parseSearchTermsLlmOutput(rawResponse)
    log.info("Search terms parsed", { count: suggestions.length })
  } catch (err) {
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

  return { llmInteractionId, suggestions }
}

interface LogInput {
  userId: string
  model: string
  prompt: string
  response?: string
  status: "SUCCESS" | "ERROR"
  errorMessage?: string
  latencyMs: number
}

async function safeLog(
  log: ReturnType<typeof createLogger>,
  repo: SqlLlmInteractionsRepository,
  input: LogInput,
): Promise<void> {
  try {
    await repo.log(input)
  } catch (err) {
    log.warn("Failed to log LLM interaction — continuing", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
