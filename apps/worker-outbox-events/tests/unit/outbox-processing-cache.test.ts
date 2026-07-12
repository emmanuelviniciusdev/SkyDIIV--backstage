import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the outbox processing lock cache helpers.
 * Mocks the Redis primitives to verify correct key naming and delegation.
 */

const { mockSetRedisKeyNx, mockDeleteRedisKey } = vi.hoisted(() => ({
  mockSetRedisKeyNx: vi.fn(),
  mockDeleteRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  setRedisKeyNx: mockSetRedisKeyNx,
  deleteRedisKey: mockDeleteRedisKey,
}))

import {
  tryAcquireOutboxProcessingLock,
  releaseOutboxProcessingLock,
} from "../../src/lib/cache/outbox-processing-cache"

const EVENT_ID = "evt-uuid-abc"
const EXPECTED_KEY = `outbox-processing:${EVENT_ID}`

describe("tryAcquireOutboxProcessingLock", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns true when the lock was acquired (key did not exist)", async () => {
    mockSetRedisKeyNx.mockResolvedValueOnce(true)

    const result = await tryAcquireOutboxProcessingLock(EVENT_ID)

    expect(result).toBe(true)
    expect(mockSetRedisKeyNx).toHaveBeenCalledWith(EXPECTED_KEY, expect.any(Number))
  })

  it("returns false when the lock is already held (key already existed)", async () => {
    mockSetRedisKeyNx.mockResolvedValueOnce(false)

    const result = await tryAcquireOutboxProcessingLock(EVENT_ID)

    expect(result).toBe(false)
  })

  it("sets a positive TTL as safety net", async () => {
    mockSetRedisKeyNx.mockResolvedValueOnce(true)

    await tryAcquireOutboxProcessingLock(EVENT_ID)

    const ttl = mockSetRedisKeyNx.mock.calls[0]![1] as number
    expect(ttl).toBeGreaterThan(0)
  })

  it("propagates Redis errors", async () => {
    mockSetRedisKeyNx.mockRejectedValueOnce(new Error("Redis SET NX failed"))

    await expect(tryAcquireOutboxProcessingLock(EVENT_ID)).rejects.toThrow("Redis SET NX failed")
  })
})

describe("releaseOutboxProcessingLock", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes the outbox-processing key for the given event ID", async () => {
    mockDeleteRedisKey.mockResolvedValueOnce(undefined)

    await releaseOutboxProcessingLock(EVENT_ID)

    expect(mockDeleteRedisKey).toHaveBeenCalledWith(EXPECTED_KEY)
  })

  it("propagates Redis errors", async () => {
    mockDeleteRedisKey.mockRejectedValueOnce(new Error("Redis DEL failed"))

    await expect(releaseOutboxProcessingLock(EVENT_ID)).rejects.toThrow("Redis DEL failed")
  })
})
