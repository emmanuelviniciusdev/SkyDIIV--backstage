import { parsePositiveIntEnv } from "../env/positive-int"

export const FEEDBACK_SUMMARY_CHUNK_SIZE_ENV = "FEEDBACK_SUMMARY_CHUNK_SIZE"
export const FEEDBACK_SUMMARY_MAX_ENTRIES_ENV = "FEEDBACK_SUMMARY_MAX_ENTRIES"

export const DEFAULT_FEEDBACK_SUMMARY_CHUNK_SIZE = 50
export const DEFAULT_FEEDBACK_SUMMARY_MAX_ENTRIES = 250

export function resolveFeedbackSummaryChunkSize(): number {
  return parsePositiveIntEnv(
    FEEDBACK_SUMMARY_CHUNK_SIZE_ENV,
    DEFAULT_FEEDBACK_SUMMARY_CHUNK_SIZE,
  )
}

export function resolveFeedbackSummaryMaxEntries(): number {
  return parsePositiveIntEnv(
    FEEDBACK_SUMMARY_MAX_ENTRIES_ENV,
    DEFAULT_FEEDBACK_SUMMARY_MAX_ENTRIES,
  )
}
