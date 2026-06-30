import { describe, it, expect, vi } from "vitest"
import { SqlWardrobeRepository } from "../../src/lib/db/wardrobe.repository"
import type postgres from "postgres"

function makeSqlMock(rows: unknown[] = []): postgres.Sql {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

describe("SqlWardrobeRepository.findByUserId()", () => {
  it("returns mapped WardrobeItem array with imageUrl and piece type fields", async () => {
    const dbRows = [
      {
        id: "i1",
        title: "White Shirt",
        image_url: "https://r2.example.com/shirt.jpg",
        tags: ["formal"],
        piece_type: "Top",
        piece_subtype: "Shirt",
      },
      {
        id: "i2",
        title: "Black Jeans",
        image_url: null,
        tags: ["casual", "denim"],
        piece_type: "Bottom",
        piece_subtype: "Jeans",
      },
    ]
    const db = makeSqlMock(dbRows)
    const repo = new SqlWardrobeRepository(db)

    const result = await repo.findByUserId("user-123")

    expect(result).toEqual([
      {
        id: "i1",
        title: "White Shirt",
        imageUrl: "https://r2.example.com/shirt.jpg",
        tags: ["formal"],
        pieceType: "Top",
        pieceSubtype: "Shirt",
      },
      {
        id: "i2",
        title: "Black Jeans",
        imageUrl: null,
        tags: ["casual", "denim"],
        pieceType: "Bottom",
        pieceSubtype: "Jeans",
      },
    ])
  })

  it("returns an empty array when user has no wardrobe items", async () => {
    const db = makeSqlMock([])
    const repo = new SqlWardrobeRepository(db)
    expect(await repo.findByUserId("user-empty")).toEqual([])
  })

  it("maps items with an empty tags array correctly", async () => {
    const db = makeSqlMock([
      { id: "i1", title: "Mystery Item", image_url: null, tags: [], piece_type: null, piece_subtype: null },
    ])
    const repo = new SqlWardrobeRepository(db)
    const item = (await repo.findByUserId("user-123"))[0]
    expect(item.tags).toEqual([])
    expect(item.imageUrl).toBeNull()
    expect(item.pieceType).toBeNull()
    expect(item.pieceSubtype).toBeNull()
  })

  it("maps imageUrl to null when image_url column is null", async () => {
    const db = makeSqlMock([
      { id: "i1", title: "No Image Item", image_url: null, tags: [], piece_type: null, piece_subtype: null },
    ])
    const repo = new SqlWardrobeRepository(db)
    const result = await repo.findByUserId("user-123")
    expect(result[0].imageUrl).toBeNull()
  })

  it("maps imageUrl correctly when image_url column has a value", async () => {
    const url = "https://assets.skydiiv.com/items/shirt.jpg"
    const db = makeSqlMock([{ id: "i1", title: "Shirt", image_url: url, tags: [], piece_type: null, piece_subtype: null }])
    const repo = new SqlWardrobeRepository(db)
    const result = await repo.findByUserId("user-123")
    expect(result[0].imageUrl).toBe(url)
  })

  it("maps pieceType and pieceSubtype from piece_type and piece_subtype columns", async () => {
    const db = makeSqlMock([
      { id: "i1", title: "Blazer", image_url: null, tags: [], piece_type: "Outerwear", piece_subtype: "Blazer" },
    ])
    const repo = new SqlWardrobeRepository(db)
    const result = await repo.findByUserId("user-123")
    expect(result[0].pieceType).toBe("Outerwear")
    expect(result[0].pieceSubtype).toBe("Blazer")
  })

  it("maps pieceType and pieceSubtype to null when columns are null", async () => {
    const db = makeSqlMock([
      { id: "i1", title: "Unclassified Item", image_url: null, tags: [], piece_type: null, piece_subtype: null },
    ])
    const repo = new SqlWardrobeRepository(db)
    const result = await repo.findByUserId("user-123")
    expect(result[0].pieceType).toBeNull()
    expect(result[0].pieceSubtype).toBeNull()
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
