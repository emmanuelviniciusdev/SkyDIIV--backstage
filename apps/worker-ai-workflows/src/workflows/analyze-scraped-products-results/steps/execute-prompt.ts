import { getWriteDb } from "../../../lib/db/client"
import { SqlLlmInteractionsRepository } from "../../../lib/db/llm-interactions.repository"
import { getLlmProvider } from "../../../lib/llm"
import {
  parseAnalyzeResultsLlmOutput,
  type ChosenListing,
} from "../../../lib/prompt/analyze-results-response"
import { createLogger } from "../../../lib/logger"

export interface ExecuteAnalyzePromptInput {
  userId: string
  prompt: string
}

export interface ExecuteAnalyzePromptResult {
  llmInteractionId: string
  chosen: ChosenListing[]
}

export async function executeAnalyzePromptStep(
  input: ExecuteAnalyzePromptInput,
): Promise<ExecuteAnalyzePromptResult> {
  const log = createLogger("execute-prompt-analyze-results", input.userId)
  const llm = getLlmProvider()
  const logRepo = new SqlLlmInteractionsRepository(getWriteDb())
  const startedAt = Date.now()
  let rawResponse: string

  try {
    rawResponse = await llm.generate(input.prompt)
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

  let chosen: ChosenListing[]
  try {
    chosen = parseAnalyzeResultsLlmOutput(rawResponse)
    log.info("Analyze choices parsed", { count: chosen.length })
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

  return { llmInteractionId, chosen }
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
