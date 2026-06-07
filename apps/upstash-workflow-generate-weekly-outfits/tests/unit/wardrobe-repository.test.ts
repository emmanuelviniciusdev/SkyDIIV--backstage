import { describe, it, expect, vi } from "vitest"
import { SqlWardrobeRepository } from "../../src/lib/db/wardrobe.repository"
import type postgres from "postgres"

function makeSqlMock(rows: unknown[] = []): postgres.Sql {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

describe("SqlWardrobeRepository.findByUserId()", () => {
  it("returns mapped WardrobeItem array with imageUrl", async () => {
    const dbRows = [
      { id: "i1", title: "White Shirt", image_url: "https://r2.example.com/shirt.jpg", tags: ["formal"] },
      { id: "i2", title: "Black Jeans", image_url: null, tags: ["casual", "denim"] },
    ]
    const db = makeSqlMock(dbRows)
    const repo = new SqlWardrobeRepository(db)

    const result = await repo.findByUserId("user-123")

    expect(result).toEqual([
      { id: "i1", title: "White Shirt", imageUrl: "https://r2.example.com/shirt.jpg", tags: ["formal"] },
      { id: "i2", title: "Black Jeans", imageUrl: null, tags: ["casual", "denim"] },
    ])
  })

  it("returns an empty array when user has no wardrobe items", async () => {
    const db = makeSqlMock([])
    const repo = new SqlWardrobeRepository(db)
    expect(await repo.findByUserId("user-empty")).toEqual([])
  })

  it("maps items with an empty tags array correctly", async () => {
    const db = makeSqlMock([{ id: "i1", title: "Mystery Item", image_url: null, tags: [] }])
    const repo = new SqlWardrobeRepository(db)
    const item = (await repo.findByUserId("user-123"))[0]
    expect(item.tags).toEqual([])
    expect(item.imageUrl).toBeNull()
  })

  it("maps imageUrl to null when image_url column is null", async () => {
    const db = makeSqlMock([{ id: "i1", title: "No Image Item", image_url: null, tags: [] }])
    const repo = new SqlWardrobeRepository(db)
    const result = await repo.findByUserId("user-123")
    expect(result[0].imageUrl).toBeNull()
  })

  it("maps imageUrl correctly when image_url column has a value", async () => {
    const url = "https://assets.skydiiv.com/items/shirt.jpg"
    const db = makeSqlMock([{ id: "i1", title: "Shirt", image_url: url, tags: [] }])
    const repo = new SqlWardrobeRepository(db)
    const result = await repo.findByUserId("user-123")
    expect(result[0].imageUrl).toBe(url)
  })

  it("calls the database with the userId parameter", async () => {
    const db = makeSqlMock([])
    const repo = new SqlWardrobeRepository(db)
    await repo.findByUserId("user-abc")

    expect(db).toHaveBeenCalledOnce()
    const callArgs = (db as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(callArgs).toContain("user-abc")
  })
})
