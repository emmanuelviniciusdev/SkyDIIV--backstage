import { getWriteDb } from "../../../lib/db/client"
import { SqlSummariesFeedbacksAutomaticThriftingRepository } from "../../../lib/db/summaries-feedbacks-automatic-thrifting.repository"
import { createLogger } from "../../../lib/logger"

export interface PersistFeedbackSummaryInput {
  userId: string
  summary: string
  readAtIso: string
  clearStaleEmpty?: boolean
}

export async function persistFeedbackSummaryStep(
  input: PersistFeedbackSummaryInput,
): Promise<void> {
  const log = createLogger("persist-feedback-summary", input.userId)
  const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(getWriteDb())
  const readAt = new Date(input.readAtIso)

  if (input.clearStaleEmpty) {
    await repo.clearStaleEmpty({ userId: input.userId, readAt })
    log.info("Cleared stale empty feedback summary")
    return
  }

  await repo.upsertSummary({
    userId: input.userId,
    summary: input.summary,
    readAt,
  })
  log.info("Persisted feedback summary", { length: input.summary.length })
}
