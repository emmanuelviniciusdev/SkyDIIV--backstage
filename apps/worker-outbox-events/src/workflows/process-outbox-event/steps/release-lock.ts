import { releaseOutboxProcessingLock } from "../../../lib/cache/outbox-processing-cache"
import { createLogger } from "../../../lib/logger"

export async function releaseOutboxProcessingLockStep(outboxEventId: string): Promise<void> {
  const log = createLogger("release-lock")
  log.info("Step started", { outboxEventId })

  await releaseOutboxProcessingLock(outboxEventId)

  log.info("Step completed", { outboxEventId })
}
