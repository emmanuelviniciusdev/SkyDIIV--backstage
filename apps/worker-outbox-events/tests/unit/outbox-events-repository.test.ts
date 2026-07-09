import { describe, it, expect, vi, beforeEach } from "vitest"
import { SqlOutboxEventsRepository } from "../../src/lib/db/outbox-events.repository"

/**
 * Unit tests for SqlOutboxEventsRepository.
 * Mocks postgres.js tagged-template calls to validate query results and
 * the null-coalescing behaviour on missing rows.
 */

describe("SqlOutboxEventsRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("findById", () => {
    it("returns the outbox event row when found", async () => {
      const row = {
        id: "evt-uuid-1",
        flow: "sync-language",
        event: "language-changed",
        payload: { userId: "user-1", oldLocale: "en", newLocale: "pt" },
        status: "PENDING",
        created_at: new Date("2026-01-01"),
        created_by: "user@example.com",
        updated_at: new Date("2026-01-01"),
        updated_by: null,
      }

      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([row]))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      const result = await repo.findById("evt-uuid-1")

      expect(result).toEqual(row)
    })

    it("returns null when no row is found", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([]))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      const result = await repo.findById("nonexistent-id")

      expect(result).toBeNull()
    })

    it("propagates DB errors", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.reject(new Error("DB down")))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      await expect(repo.findById("evt-uuid-1")).rejects.toThrow("DB down")
    })
  })

  describe("deleteById", () => {
    it("executes the DELETE query without returning a value", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([]))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      await expect(repo.deleteById("evt-uuid-1")).resolves.toBeUndefined()
      expect(mockDb).toHaveBeenCalledOnce()
    })

    it("propagates DB errors on delete", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.reject(new Error("constraint error")))
      const repo = new SqlOutboxEventsRepository(mockDb as never)

      await expect(repo.deleteById("evt-uuid-1")).rejects.toThrow("constraint error")
    })
  })
})
