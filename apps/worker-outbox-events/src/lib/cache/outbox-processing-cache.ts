import { existsRedisKey, setRedisKey, deleteRedisKey } from "./redis"

/**
 * TTL for the processing lock in seconds.
 * Acts as a safety net: if the worker crashes mid-process the key eventually
 * expires, allowing QStash to retry without the lock blocking it indefinitely.
 */
const PROCESSING_LOCK_TTL_SECONDS = 300 // 5 minutes

function buildProcessingKey(outboxEventId: string): string {
  return `outbox-processing:${outboxEventId}`
}

/**
 * Returns true if a processing lock already exists for the given outbox event.
 * Used to detect concurrent duplicate invocations and skip redundant work.
 */
export async function isOutboxEventBeingProcessed(outboxEventId: string): Promise<boolean> {
  return existsRedisKey(buildProcessingKey(outboxEventId))
}

/**
 * Acquires the processing lock for the given outbox event.
 * The lock is set with a TTL so it self-expires if the worker crashes before
 * `releaseOutboxProcessingLock` is called.
 */
export async function acquireOutboxProcessingLock(outboxEventId: string): Promise<void> {
  await setRedisKey(buildProcessingKey(outboxEventId), PROCESSING_LOCK_TTL_SECONDS)
}

/**
 * Releases the processing lock for the given outbox event.
 * Should be called after successful processing to allow future reprocessing
 * if the same ID were to appear again (e.g. from a replay).
 */
export async function releaseOutboxProcessingLock(outboxEventId: string): Promise<void> {
  await deleteRedisKey(buildProcessingKey(outboxEventId))
}
