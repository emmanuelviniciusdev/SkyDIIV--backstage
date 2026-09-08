import type { FeedbackAutomaticThriftingRow } from "../db/feedbacks-automatic-thrifting.repository"
import { factoryFeedbackRows, type FeedbackFactoryRecord } from "./feedback-factory"

export function countFeedbackSummaryChunks(itemCount: number, chunkSize: number): number {
  if (itemCount <= 0 || chunkSize <= 0) return 0
  return Math.ceil(itemCount / chunkSize)
}

export function selectMostRecentFeedbacks(
  rowsNewestFirst: FeedbackAutomaticThriftingRow[],
  maxEntries: number,
): FeedbackAutomaticThriftingRow[] {
  return rowsNewestFirst.slice(0, maxEntries)
}

/** Newest-first rows → chronological factory records (oldest of the window first). */
export function factoryChronologicalWindow(
  rowsNewestFirst: FeedbackAutomaticThriftingRow[],
  maxEntries: number,
): FeedbackFactoryRecord[] {
  const window = selectMostRecentFeedbacks(rowsNewestFirst, maxEntries)
  return factoryFeedbackRows([...window].reverse())
}

export function sliceFeedbackChunk<T>(records: T[], chunkIndex: number, chunkSize: number): T[] {
  return records.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)
}

export function factoryRecordsForChunk(
  rowsNewestFirst: FeedbackAutomaticThriftingRow[],
  maxEntries: number,
  chunkIndex: number,
  chunkSize: number,
): FeedbackFactoryRecord[] {
  const records = factoryChronologicalWindow(rowsNewestFirst, maxEntries)
  return sliceFeedbackChunk(records, chunkIndex, chunkSize)
}
