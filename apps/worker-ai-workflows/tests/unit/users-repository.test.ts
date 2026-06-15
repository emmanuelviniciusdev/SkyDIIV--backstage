import { describe, it, expect, vi } from "vitest"
import { SqlUsersRepository } from "../../src/lib/db/users.repository"
import type postgres from "postgres"

function makeSqlMock(rows: unknown[] = []): postgres.Sql {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

describe("SqlUsersRepository.findByUserId()", () => {
  it("returns mapped UserProfile when a user row exists", async () => {
    const db = makeSqlMock([{ first_name: "Maria", last_name: "Silva" }])
    const repo = new SqlUsersRepository(db)

    const result = await repo.findByUserId("user-123")

    expect(result).toEqual({ firstName: "Maria", lastName: "Silva" })
  })

  it("returns null when the user is not found", async () => {
    const db = makeSqlMock([])
    const repo = new SqlUsersRepository(db)

    expect(await repo.findByUserId("unknown-user")).toBeNull()
  })

  it("calls the database with the userId parameter", async () => {
    const db = makeSqlMock([])
    const repo = new SqlUsersRepository(db)

    await repo.findByUserId("user-abc")

    expect(db).toHaveBeenCalledOnce()
    const callArgs = (db as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs).toContain("user-abc")
  })
})
