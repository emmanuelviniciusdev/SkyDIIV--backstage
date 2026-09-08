import { getReadDb, getWriteDb } from "../../../lib/db/client"
import { SqlFeedbacksAutomaticThriftingRepository } from "../../../lib/db/feedbacks-automatic-thrifting.repository"
import { SqlLlmInteractionsRepository } from "../../../lib/db/llm-interactions.repository"
import { getLlmProvider } from "../../../lib/llm"
import type { Locale } from "../../../lib/i18n"
import { factoryRecordsForChunk } from "../../../lib/automatic-thrifting/feedback-summary-chunks"
import { summarizeFactoryChunk } from "../../../lib/automatic-thrifting/fold-feedback-summary"
import { buildSummarizeAutomaticThriftingFeedbackPrompt } from "../../../lib/i18n/prompts/summarize-automatic-thrifting-feedback"
import { createLogger } from "../../../lib/logger"

export interface SummarizeFeedbackChunkInput {
  userId: string
  locale: Locale
  chunkIndex: number
  chunkSize: number
  maxEntries: number
  priorSummary: string
}

export async function summarizeFeedbackChunkStep(
  input: SummarizeFeedbackChunkInput,
): Promise<string> {
  const log = createLogger("summarize-feedback-chunk", input.userId)
  const llm = getLlmProvider()
  const logRepo = new SqlLlmInteractionsRepository(getWriteDb())
  const rows = await new SqlFeedbacksAutomaticThriftingRepository(
    getReadDb(),
  ).findMostRecentByUserId(input.userId, input.maxEntries)
  const records = factoryRecordsForChunk(
    rows,
    input.maxEntries,
    input.chunkIndex,
    input.chunkSize,
  )

  if (records.length === 0) return input.priorSummary

  const prompt = buildSummarizeAutomaticThriftingFeedbackPrompt({
    locale: input.locale,
    priorSummary: input.priorSummary,
    records,
  })

  const startedAt = Date.now()
  try {
    const summary = await summarizeFactoryChunk({
      locale: input.locale,
      priorSummary: input.priorSummary,
      records,
      generate: (text) => llm.generate(text),
    })
    await logRepo.log({
      userId: input.userId,
      model: llm.name,
      prompt,
      response: summary,
      status: "SUCCESS",
      latencyMs: Date.now() - startedAt,
    })
    log.info("Summarized feedback chunk", {
      chunkIndex: input.chunkIndex,
      recordCount: records.length,
    })
    return summary
  } catch (err) {
    try {
      await logRepo.log({
        userId: input.userId,
        model: llm.name,
        prompt,
        status: "ERROR",
        errorMessage: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startedAt,
      })
    } catch (logErr) {
      log.warn("Failed to log summarizer LLM interaction — continuing", {
        error: logErr instanceof Error ? logErr.message : String(logErr),
      })
    }
    throw err
  }
}
