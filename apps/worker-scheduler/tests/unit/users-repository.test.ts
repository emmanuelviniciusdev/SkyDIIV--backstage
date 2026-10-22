import { describe, it, expect, vi, beforeEach } from "vitest"
import { SqlUsersRepository } from "../../src/lib/db/users.repository"

describe("SqlUsersRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("findUsersWithOutfitPreferences", () => {
    it("returns mapped EligibleUser list when preferences rows exist", async () => {
      const mockRows = [
        { user_id: "user-uuid-1" },
        { user_id: "user-uuid-2" },
        { user_id: "user-uuid-3" },
      ]

      const mockDb = vi.fn().mockResolvedValue(mockRows)
      // postgres tagged-template calls the function with template parts + values
      mockDb.mockImplementation(() => Promise.resolve(mockRows))

      const repo = new SqlUsersRepository(mockDb as never)
      const result = await repo.findUsersWithOutfitPreferences()

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({ userId: "user-uuid-1" })
      expect(result[1]).toEqual({ userId: "user-uuid-2" })
      expect(result[2]).toEqual({ userId: "user-uuid-3" })
    })

    it("returns empty array when no preferences rows exist", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([]))

      const repo = new SqlUsersRepository(mockDb as never)
      const result = await repo.findUsersWithOutfitPreferences()

      expect(result).toEqual([])
    })

    it("selects sealed complete rows and excludes sealed or legacy rows that are not opted in", async () => {
      const mockDb = vi.fn().mockImplementation(() => Promise.resolve([{ user_id: "sealed-user" }]))
      const repo = new SqlUsersRepository(mockDb as never)

      const result = await repo.findUsersWithOutfitPreferences()

      expect(result).toEqual([{ userId: "sealed-user" }])
      const sql = mockDb.mock.calls
        .flatMap((call) => {
          const first = call[0]
          if (Array.isArray(first)) return first.filter((part): part is string => typeof part === "string")
          return []
        })
        .join(" ")
      expect(sql).toContain("dek IS NULL")
      expect(sql).toContain("location <> ''")
      expect(sql).toContain("routine_description <> ''")
      expect(sql).toContain("dek IS NOT NULL")
      expect(sql).toContain("encrypted_columns @> ARRAY['location', 'routine_description']::text[]")
      expect(sql).not.toMatch(/decrypt/i)
    })
  })
})
