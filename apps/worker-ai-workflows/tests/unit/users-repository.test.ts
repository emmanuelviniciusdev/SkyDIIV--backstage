import { describe, it, expect, vi } from "vitest"
import {
  resolveUserDisplayName,
  SqlUsersRepository,
  type UserProfile,
} from "../../src/lib/db/users.repository"
import type postgres from "postgres"

function makeSqlMock(rows: unknown[] = []): postgres.Sql {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

describe("SqlUsersRepository.findByUserId()", () => {
  it("returns mapped UserProfile when a user row exists", async () => {
    const db = makeSqlMock([
      { preferred_name: "Mari", first_name: "Maria", last_name: "Silva" },
    ])
    const repo = new SqlUsersRepository(db)

    const result = await repo.findByUserId("user-123")

    expect(result).toEqual({
      preferredName: "Mari",
      firstName: "Maria",
      lastName: "Silva",
    })
  })

  it("maps a null preferred_name", async () => {
    const db = makeSqlMock([
      { preferred_name: null, first_name: "Maria", last_name: "Silva" },
    ])
    const repo = new SqlUsersRepository(db)

    const result = await repo.findByUserId("user-123")

    expect(result).toEqual({
      preferredName: null,
      firstName: "Maria",
      lastName: "Silva",
    })
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

describe("resolveUserDisplayName()", () => {
  const base: UserProfile = {
    preferredName: null,
    firstName: "Maria",
    lastName: "Silva",
  }

  it("returns preferred_name when present", () => {
    expect(resolveUserDisplayName({ ...base, preferredName: "Mari" })).toBe("Mari")
  })

  it("trims preferred_name", () => {
    expect(resolveUserDisplayName({ ...base, preferredName: "  Mari  " })).toBe("Mari")
  })

  it("falls back to first + last when preferred_name is empty", () => {
    expect(resolveUserDisplayName({ ...base, preferredName: "" })).toBe("Maria Silva")
    expect(resolveUserDisplayName({ ...base, preferredName: "   " })).toBe("Maria Silva")
    expect(resolveUserDisplayName({ ...base, preferredName: null })).toBe("Maria Silva")
  })

  it("omits blank first or last name parts in the fallback", () => {
    expect(
      resolveUserDisplayName({ preferredName: null, firstName: "Maria", lastName: "" }),
    ).toBe("Maria")
    expect(
      resolveUserDisplayName({ preferredName: null, firstName: "", lastName: "Silva" }),
    ).toBe("Silva")
  })

  it("returns empty string when user is missing or has no name fields", () => {
    expect(resolveUserDisplayName(null)).toBe("")
    expect(resolveUserDisplayName(undefined)).toBe("")
    expect(
      resolveUserDisplayName({ preferredName: null, firstName: "", lastName: "" }),
    ).toBe("")
  })
})
