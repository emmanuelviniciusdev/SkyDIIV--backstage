import type { Locale } from "../i18n/config"
import { buildSummarizeAutomaticThriftingFeedbackPrompt } from "../i18n/prompts/summarize-automatic-thrifting-feedback"
import { parseFeedbackSummaryLlmOutput } from "../prompt/feedback-summary-response"
import type { FeedbackAutomaticThriftingRow } from "../db/feedbacks-automatic-thrifting.repository"
import {
  countFeedbackSummaryChunks,
  factoryChronologicalWindow,
  factoryRecordsForChunk,
  sliceFeedbackChunk,
} from "./feedback-summary-chunks"

export interface FoldFeedbackSummaryChunksInput {
  rowsNewestFirst: FeedbackAutomaticThriftingRow[]
  maxEntries: number
  chunkSize: number
  locale: Locale
  generate: (prompt: string) => Promise<string>
}

export async function foldFeedbackSummaryChunks(
  input: FoldFeedbackSummaryChunksInput,
): Promise<string> {
  const records = factoryChronologicalWindow(input.rowsNewestFirst, input.maxEntries)
  const chunkCount = countFeedbackSummaryChunks(records.length, input.chunkSize)
  let running = ""
  for (let i = 0; i < chunkCount; i++) {
    const slice = sliceFeedbackChunk(records, i, input.chunkSize)
    running = await summarizeFactoryChunk({
      locale: input.locale,
      priorSummary: running,
      records: slice,
      generate: input.generate,
    })
  }
  return running
}

export async function summarizeFactoryChunk(input: {
  locale: Locale
  priorSummary: string
  records: ReturnType<typeof factoryRecordsForChunk>
  generate: (prompt: string) => Promise<string>
}): Promise<string> {
  if (input.records.length === 0) return input.priorSummary
  const prompt = buildSummarizeAutomaticThriftingFeedbackPrompt({
    locale: input.locale,
    priorSummary: input.priorSummary,
    records: input.records,
  })
  const raw = await input.generate(prompt)
  return parseFeedbackSummaryLlmOutput(raw)
}
