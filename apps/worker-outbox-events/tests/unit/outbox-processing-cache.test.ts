import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Unit tests for the outbox processing lock cache helpers.
 * Mocks the Redis primitives to verify correct key naming and delegation.
 */

const { mockExistsRedisKey, mockSetRedisKey, mockDeleteRedisKey } = vi.hoisted(() => ({
  mockExistsRedisKey: vi.fn(),
  mockSetRedisKey: vi.fn(),
  mockDeleteRedisKey: vi.fn(),
}))

vi.mock("../../src/lib/cache/redis", () => ({
  existsRedisKey: mockExistsRedisKey,
  setRedisKey: mockSetRedisKey,
  deleteRedisKey: mockDeleteRedisKey,
}))

import {
  isOutboxEventBeingProcessed,
  acquireOutboxProcessingLock,
  releaseOutboxProcessingLock,
} from "../../src/lib/cache/outbox-processing-cache"

const EVENT_ID = "evt-uuid-abc"
const EXPECTED_KEY = `outbox-processing:${EVENT_ID}`

describe("isOutboxEventBeingProcessed", () => {
  beforeEach(() => vi.clearAllMocks())

  it("checks the outbox-processing key for the given event ID", async () => {
    mockExistsRedisKey.mockResolvedValueOnce(true)

    const result = await isOutboxEventBeingProcessed(EVENT_ID)

    expect(result).toBe(true)
    expect(mockExistsRedisKey).toHaveBeenCalledWith(EXPECTED_KEY)
  })

  it("returns false when the key does not exist", async () => {
    mockExistsRedisKey.mockResolvedValueOnce(false)

    const result = await isOutboxEventBeingProcessed(EVENT_ID)

    expect(result).toBe(false)
  })

  it("propagates Redis errors", async () => {
    mockExistsRedisKey.mockRejectedValueOnce(new Error("Redis unavailable"))

    await expect(isOutboxEventBeingProcessed(EVENT_ID)).rejects.toThrow("Redis unavailable")
  })
})

describe("acquireOutboxProcessingLock", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sets the outbox-processing key with a TTL for the given event ID", async () => {
    mockSetRedisKey.mockResolvedValueOnce(undefined)

    await acquireOutboxProcessingLock(EVENT_ID)

    expect(mockSetRedisKey).toHaveBeenCalledOnce()
    expect(mockSetRedisKey).toHaveBeenCalledWith(EXPECTED_KEY, expect.any(Number))
  })

  it("sets a positive TTL as safety net", async () => {
    mockSetRedisKey.mockResolvedValueOnce(undefined)

    await acquireOutboxProcessingLock(EVENT_ID)

    const ttl = mockSetRedisKey.mock.calls[0]![1] as number
    expect(ttl).toBeGreaterThan(0)
  })

  it("propagates Redis errors", async () => {
    mockSetRedisKey.mockRejectedValueOnce(new Error("Redis SET failed"))

    await expect(acquireOutboxProcessingLock(EVENT_ID)).rejects.toThrow("Redis SET failed")
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
