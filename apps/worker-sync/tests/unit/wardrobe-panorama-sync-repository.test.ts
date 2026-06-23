import { describe, it, expect, vi } from "vitest"
import { SqlWardrobePanoramaSyncRepository } from "../../src/lib/db/wardrobe-panorama.repository"
import type postgres from "postgres"

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
    return []
  })
}

describe("SqlWardrobePanoramaSyncRepository", () => {
  it("findTranslatableByUserId returns the first panorama row", async () => {
    const readDb = vi.fn().mockResolvedValue([
      { id: "panorama-1", content: "Analysis" },
    ]) as unknown as postgres.Sql
    const writeDb = vi.fn() as unknown as postgres.Sql
    const repo = new SqlWardrobePanoramaSyncRepository(readDb, writeDb)

    const result = await repo.findTranslatableByUserId("user-123")

    expect(result).toEqual({ id: "panorama-1", content: "Analysis" })
    const sql = getSqlStrings(readDb as unknown as ReturnType<typeof vi.fn>).join(" ")
    expect(sql).toContain("wardrobe_panorama")
  })

  it("updateContent updates wardrobe_panorama.content", async () => {
    const readDb = vi.fn() as unknown as postgres.Sql
    const writeDb = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    const repo = new SqlWardrobePanoramaSyncRepository(readDb, writeDb)

    await repo.updateContent("panorama-1", "Conteúdo traduzido")

    expect(writeDb).toHaveBeenCalledOnce()
    const sql = getSqlStrings(writeDb as unknown as ReturnType<typeof vi.fn>).join(" ")
    expect(sql).toContain("UPDATE wardrobe_panorama")
  })
})
