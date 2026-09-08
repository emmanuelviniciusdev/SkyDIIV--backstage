import { getReadDb } from "../../../lib/db/client"
import { SqlFeedbacksAutomaticThriftingRepository } from "../../../lib/db/feedbacks-automatic-thrifting.repository"
import { SqlSummariesFeedbacksAutomaticThriftingRepository } from "../../../lib/db/summaries-feedbacks-automatic-thrifting.repository"
import { factoryChronologicalWindow, countFeedbackSummaryChunks } from "../../../lib/automatic-thrifting/feedback-summary-chunks"
import {
  resolveFeedbackSummaryChunkSize,
  resolveFeedbackSummaryMaxEntries,
} from "../../../lib/automatic-thrifting/feedback-summary-env"
import { createLogger } from "../../../lib/logger"

export type FeedbackSummaryPlan =
  | { action: "skip"; readAtIso: string }
  | { action: "reuse"; reusedSummary: string; readAtIso: string }
  | { action: "clear-stale-empty"; readAtIso: string }
  | {
      action: "refresh"
      chunkCount: number
      chunkSize: number
      maxEntries: number
      readAtIso: string
    }

export async function planFeedbackSummaryStep(userId: string): Promise<FeedbackSummaryPlan> {
  const log = createLogger("plan-feedback-summary")
  const db = getReadDb()
  const feedbackRepo = new SqlFeedbacksAutomaticThriftingRepository(db)
  const summaryRepo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)

  const [count, existing] = await Promise.all([
    feedbackRepo.countByUserId(userId),
    summaryRepo.findByUserId(userId),
  ])

  const readAtIso = (existing?.updatedAt ?? new Date()).toISOString()
  const chunkSize = resolveFeedbackSummaryChunkSize()
  const maxEntries = resolveFeedbackSummaryMaxEntries()

  if (count === 0) {
    if (existing?.outdated) {
      log.info("No feedbacks — will clear stale summary", { userId })
      return { action: "clear-stale-empty", readAtIso }
    }
    log.info("No feedbacks — skip summarizer", { userId })
    return { action: "skip", readAtIso }
  }

  if (existing && !existing.outdated) {
    log.info("Reusing current feedback summary", { userId })
    return { action: "reuse", reusedSummary: existing.summary, readAtIso }
  }

  const rows = await feedbackRepo.findMostRecentByUserId(userId, maxEntries)
  const records = factoryChronologicalWindow(rows, maxEntries)
  if (records.length === 0) {
    log.info("Recent window factories to zero records — skip summarizer", { userId })
    return { action: "skip", readAtIso }
  }

  const chunkCount = countFeedbackSummaryChunks(records.length, chunkSize)
  log.info("Will refresh feedback summary", { userId, chunkCount, chunkSize, maxEntries })
  return { action: "refresh", chunkCount, chunkSize, maxEntries, readAtIso }
}
