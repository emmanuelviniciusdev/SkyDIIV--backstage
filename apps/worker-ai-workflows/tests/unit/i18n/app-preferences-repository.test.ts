import { describe, it, expect, vi } from "vitest"
import { SqlAppPreferencesRepository } from "../../../src/lib/i18n/app-preferences.repository"
import type postgres from "postgres"

function makeSqlMock(rows: unknown[] = []): postgres.Sql {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

describe("SqlAppPreferencesRepository.findLanguageByUserId()", () => {
  it("returns mapped language domain when a row exists", async () => {
    const db = makeSqlMock([{ name: "English (US)" }])
    const repo = new SqlAppPreferencesRepository(db)

    const result = await repo.findLanguageByUserId("user-123")

    expect(result).toEqual({ name: "English (US)" })
  })

  it("returns null when app preferences are not found", async () => {
    const db = makeSqlMock([])
    const repo = new SqlAppPreferencesRepository(db)

    expect(await repo.findLanguageByUserId("unknown-user")).toBeNull()
  })

  it("calls the database with the userId parameter", async () => {
    const db = makeSqlMock([])
    const repo = new SqlAppPreferencesRepository(db)

    await repo.findLanguageByUserId("user-abc")

    expect(db).toHaveBeenCalledOnce()
    const callArgs = (db as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs).toContain("user-abc")
  })
})
