import { describe, it, expect, vi, beforeEach } from "vitest"
import { SqlOutboxEventsRepository } from "../../src/lib/db/outbox-events.repository"
import { DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES } from "../../src/lib/outbox-catchup-config"

describe("SqlOutboxEventsRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES
  })

  describe("findPendingOlderThan", () => {
    it("returns mapped StaleOutboxEvent list when pending rows exist", async () => {
      const mockRows = [{ id: "evt-uuid-1" }, { id: "evt-uuid-2" }]
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve(mockRows))

      const repo = new SqlOutboxEventsRepository(mockDb as never)
      const result = await repo.findPendingOlderThan(15)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ outboxEventId: "evt-uuid-1" })
      expect(result[1]).toEqual({ outboxEventId: "evt-uuid-2" })
    })

    it("returns empty array when no pending rows exist", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([]))

      const repo = new SqlOutboxEventsRepository(mockDb as never)
      const result = await repo.findPendingOlderThan(15)

      expect(result).toEqual([])
    })

    it("propagates DB errors", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.reject(new Error("DB down")))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      await expect(repo.findPendingOlderThan(15)).rejects.toThrow("DB down")
    })
  })

  describe("findStalePendingEvents", () => {
    it("returns events and the configured minAgeMinutes when env is valid", async () => {
      process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES = "30"
      const mockRows = [{ id: "evt-uuid-1" }]
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve(mockRows))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      const result = await repo.findStalePendingEvents()

      expect(result).toEqual({
        minAgeMinutes: 30,
        events: [{ outboxEventId: "evt-uuid-1" }],
      })
    })

    it("falls back to the default minAgeMinutes when env is invalid", async () => {
      process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES = "not-a-number"
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([]))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      const result = await repo.findStalePendingEvents()

      expect(result.minAgeMinutes).toBe(DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES)
      expect(result.events).toEqual([])
    })

    it("uses the default minAgeMinutes when env is unset", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([]))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      const result = await repo.findStalePendingEvents()

      expect(result.minAgeMinutes).toBe(DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES)
    })

    it("propagates DB errors", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.reject(new Error("DB down")))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      await expect(repo.findStalePendingEvents()).rejects.toThrow("DB down")
    })
  })
})
