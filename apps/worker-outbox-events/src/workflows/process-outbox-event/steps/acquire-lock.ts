import { tryAcquireOutboxProcessingLock } from "../../../lib/cache/outbox-processing-cache"
import { createLogger } from "../../../lib/logger"

export async function acquireOutboxProcessingLockStep(outboxEventId: string): Promise<boolean> {
  const log = createLogger("acquire-lock")
  log.info("Step started", { outboxEventId })

  const acquired = await tryAcquireOutboxProcessingLock(outboxEventId)

  log.info("Step completed", { outboxEventId, acquired })
  return acquired
}
