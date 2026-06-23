import { describe, it, expect, vi } from "vitest"
import { SqlWeeklyOutfitsSyncRepository } from "../../src/lib/db/weekly-outfits.repository"
import type postgres from "postgres"

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
    return []
  })
}

describe("SqlWeeklyOutfitsSyncRepository", () => {
  it("findTranslatableByUserId queries weekly_outfits joined to preferences", async () => {
    const readDb = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    const writeDb = vi.fn() as unknown as postgres.Sql
    const repo = new SqlWeeklyOutfitsSyncRepository(readDb, writeDb)

    await repo.findTranslatableByUserId("user-123")

    const sql = getSqlStrings(readDb as unknown as ReturnType<typeof vi.fn>).join(" ")
    expect(sql).toContain("weekly_outfits")
    expect(sql).toContain("weekly_outfit_preferences")
    expect(sql).toContain("weather_summary")
    expect(sql).toContain("description_temperature")
  })

  it("updateTranslations issues one UPDATE per record", async () => {
    const readDb = vi.fn() as unknown as postgres.Sql
    const writeDb = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    const repo = new SqlWeeklyOutfitsSyncRepository(readDb, writeDb)

    const count = await repo.updateTranslations([
      {
        id: "11111111-1111-1111-1111-111111111111",
        weather_summary: "Céu limpo",
        description_temperature: null,
      },
    ])

    expect(count).toBe(1)
    expect(writeDb).toHaveBeenCalledOnce()
    const sql = getSqlStrings(writeDb as unknown as ReturnType<typeof vi.fn>).join(" ")
    expect(sql).toContain("UPDATE weekly_outfits")
  })
})
