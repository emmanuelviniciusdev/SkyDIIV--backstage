import { getDb } from "../../../lib/db/client"
import { SqlOutboxEventsRepository } from "../../../lib/db/outbox-events.repository"
import { createLogger } from "../../../lib/logger"

export async function markOutboxEventSuccessStep(outboxEventId: string): Promise<void> {
  const log = createLogger("mark-success")
  log.info("Step started", { outboxEventId })

  const db = getDb()
  const repo = new SqlOutboxEventsRepository(db)
  await repo.updateStatus(outboxEventId, "SUCCESS")

  log.info("Step completed", { outboxEventId })
}
