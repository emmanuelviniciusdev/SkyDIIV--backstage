import { setRedisKeyNx, deleteRedisKey } from "./redis"

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
 * Atomically checks and acquires the processing lock for the given outbox event
 * using a Redis SET NX EX command. Returns `true` if the lock was acquired (this
 * invocation may proceed), or `false` if the lock was already held by a concurrent
 * invocation (this invocation should skip and return early).
 *
 * The TTL acts as a safety net: if the worker crashes before
 * `releaseOutboxProcessingLock` is called, the lock expires automatically so future
 * QStash retries can proceed.
 */
export async function tryAcquireOutboxProcessingLock(outboxEventId: string): Promise<boolean> {
  return setRedisKeyNx(buildProcessingKey(outboxEventId), PROCESSING_LOCK_TTL_SECONDS)
}

/**
 * Releases the processing lock for the given outbox event.
 */
export async function releaseOutboxProcessingLock(outboxEventId: string): Promise<void> {
  await deleteRedisKey(buildProcessingKey(outboxEventId))
}
