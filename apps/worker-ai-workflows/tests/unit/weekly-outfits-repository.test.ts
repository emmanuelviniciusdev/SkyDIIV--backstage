import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  deleteImageFromR2: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../src/lib/storage/r2-client", () => ({
  deleteImageFromR2: mocks.deleteImageFromR2,
  uploadImageToR2: vi.fn(),
}))

import { SqlWeeklyOutfitsRepository } from "../../src/lib/db/weekly-outfits.repository"
import type postgres from "postgres"
import type { SavedOutfitRef } from "../../src/lib/db/weekly-outfits.repository"
import { buildOutfitCollageLayout } from "../../src/lib/outfits/board-layout"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SqlMock = ReturnType<typeof vi.fn> & {
  begin?: ReturnType<typeof vi.fn>
}

/**
 * Write DB mock:
 * - `begin(fn)` runs `fn(tx)`
 * - `tx(ids)` helper form (postgres.js dynamic IN list) returns the ids array
 * - `tx\`...\`` tagged-template form:
 *     - DELETE … RETURNING → `deletedOutfitIds` rows
 *     - other statements → []
 */
function makeWriteDb(deletedOutfitIds: string[] = []): {
  db: postgres.Sql
  tx: ReturnType<typeof vi.fn>
} {
  const deletedRows = deletedOutfitIds.map((id) => ({ id }))
  const tx = vi.fn().mockImplementation((first: unknown) => {
    // Helper form: sql([...]) used for `IN ${tx(ids)}` / `NOT IN ${tx(ids)}`
    if (Array.isArray(first) && !Object.prototype.hasOwnProperty.call(first, "raw")) {
      return first
    }
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw")) {
      const sql = (first as string[]).join(" ")
      if (/delete from outfits/i.test(sql) && /returning/i.test(sql)) {
        return Promise.resolve(deletedRows)
      }
    }
    return Promise.resolve([])
  })
  const db = vi.fn().mockResolvedValue([]) as unknown as SqlMock
  db.begin = vi.fn().mockImplementation(
    async (fn: (t: ReturnType<typeof vi.fn>) => Promise<unknown>) => {
      return await fn(tx)
    },
  )
  return { db: db as unknown as postgres.Sql, tx }
}

function makeUnusedReadDb(): postgres.Sql {
  return vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
}

/** Flattened list of all template-string segments from every tagged-template call on a mock. */
function getSqlStrings(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw")) {
      return first.filter((s): s is string => typeof s === "string")
    }
    return []
  })
}

/** Flattened interpolated values (positions 1…n) from every tagged-template call on a mock. */
function getInterpolatedValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw")) {
      return call.slice(1)
    }
    return []
  })
}

const PIECE_TYPES = {
  "item-1": "Top",
  "item-2": "Bottom",
  "item-3": "Footwear",
}

const BASE_INPUT = {
  userId: "user-123",
  weeklyOutfitPreferencesId: "prefs-456",
  weekStartDate: "2026-06-07",
  suggestions: [
    { weekday: "sunday", clothingPieceIds: ["item-1", "item-2"] },
    { weekday: "monday", clothingPieceIds: ["item-3"] },
  ],
  dayWeatherByWeekday: {
    sunday: {
      weatherSummary: "Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%",
      weatherCode: 0,
      minTemperature: 22.1,
      maxTemperature: 28.4,
      unityTemperature: "°C",
      descriptionTemperature: "Céu limpo",
    },
    monday: {
      weatherSummary: "Parcialmente nublado, máx. 27°C / mín. 21°C, chuva: 30%",
      weatherCode: 2,
      minTemperature: 21,
      maxTemperature: 27,
      unityTemperature: "°C",
      descriptionTemperature: "Parcialmente nublado",
    },
  },
  pieceTypeById: PIECE_TYPES,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SqlWeeklyOutfitsRepository.saveWeeklyOutfits()", () => {
  beforeEach(() => {
    mocks.deleteImageFromR2.mockClear()
  })

  it("always issues a user-scoped AI_GENERATED DELETE independent of week (no pre-SELECT)", async () => {
    const { db: writeDb, tx } = makeWriteDb([])
    const readDb = makeUnusedReadDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    const deleteCall = tx.mock.calls.find((call) => {
      const first = call[0]
      return (
        Array.isArray(first) &&
        Object.prototype.hasOwnProperty.call(first, "raw") &&
        (first as string[]).some((s) => typeof s === "string" && /delete from outfits/i.test(s))
      )
    })
    expect(deleteCall).toBeDefined()
    const deleteSql = (deleteCall![0] as string[]).join(" ")
    expect(deleteSql).toMatch(/user_id/i)
    expect(deleteSql).toMatch(/ai_generated/i)
    expect(deleteSql).not.toMatch(/week_start_date/i)
    expect(deleteSql).not.toMatch(/weekly_outfit_preferences_id/i)
    expect(deleteSql).toMatch(/not in/i)
    expect(deleteSql).toMatch(/returning/i)

    const deleteValues = deleteCall!.slice(1)
    expect(deleteValues).toContain(BASE_INPUT.userId)

    // No SELECT on write or read — replacement is keyed off pre-allocated new IDs
    expect(getSqlStrings(writeDb as unknown as ReturnType<typeof vi.fn>).join(" ")).not.toMatch(
      /select/i,
    )
    expect(readDb).not.toHaveBeenCalled()
  })

  it("deletes prior AI outfits with NOT IN ${sql(newIds)} so UUID rows match", async () => {
    const { db: writeDb, tx } = makeWriteDb(["old-outfit-1", "old-outfit-2"])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    const result = await repo.saveWeeklyOutfits(BASE_INPUT)

    const deleteSql = getSqlStrings(tx).join(" ")
    expect(deleteSql).toMatch(/delete from outfits/i)
    expect(deleteSql).toMatch(/not in/i)
    expect(deleteSql).not.toMatch(/any\(/i)

    // Helper form tx(newIds) must be used so postgres.js expands the value list
    const helperCalls = tx.mock.calls.filter(
      (call) => Array.isArray(call[0]) && !Object.prototype.hasOwnProperty.call(call[0], "raw"),
    )
    expect(helperCalls.length).toBeGreaterThanOrEqual(1)
    const passedIds = helperCalls[0][0] as string[]
    expect(passedIds).toHaveLength(result.length)
    expect(passedIds).toEqual(result.map((r) => r.outfitId))
  })

  it("deletes all AI_GENERATED outfits for the user when every suggestion is skipped", async () => {
    const { db: writeDb, tx } = makeWriteDb(["old-outfit-1"])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits({
      ...BASE_INPUT,
      suggestions: [{ weekday: "funday", clothingPieceIds: ["item-1"] }],
    })

    const deleteSql = getSqlStrings(tx).join(" ")
    expect(deleteSql).toMatch(/delete from outfits/i)
    expect(deleteSql).not.toMatch(/not in/i)
    expect(deleteSql).toMatch(/returning/i)
  })

  it("best-effort deletes prior R2 thumbnails (png + jpg) after commit using RETURNING ids", async () => {
    const { db: writeDb } = makeWriteDb(["old-outfit-1"])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    expect(mocks.deleteImageFromR2).toHaveBeenCalledWith("outfits/old-outfit-1.png")
    expect(mocks.deleteImageFromR2).toHaveBeenCalledWith("outfits/old-outfit-1.jpg")
  })

  it("skips R2 cleanup when DELETE returns no rows", async () => {
    const { db: writeDb } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    expect(mocks.deleteImageFromR2).not.toHaveBeenCalled()
  })

  it("inserts outfit_items with creative-board layout columns", async () => {
    const { db: writeDb, tx } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    const sql = getSqlStrings(tx).join(" ")
    expect(sql).toMatch(/pos_x/i)
    expect(sql).toMatch(/pos_y/i)
    expect(sql).toMatch(/z_index/i)
    expect(sql).toMatch(/rotation/i)

    const expected = buildOutfitCollageLayout([
      { id: "item-1", pieceType: "Top" },
      { id: "item-2", pieceType: "Bottom" },
    ])
    const values = getInterpolatedValues(tx)
    expect(values).toContain(expected[0].posX)
    expect(values).toContain(expected[0].posY)
    expect(values).toContain(expected[0].width)
    expect(values).toContain(expected[0].zIndex)
    expect(values).toContain(0) // rotation always persisted as 0
  })

  it("runs everything inside a transaction", async () => {
    const { db: writeDb } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    expect((writeDb as unknown as SqlMock).begin).toHaveBeenCalledOnce()
  })

  it("stores weather fields in the weekly_outfits insert", async () => {
    const { db: writeDb, tx } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    const values = getInterpolatedValues(tx)
    expect(values).toContain("Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%")
    expect(values).toContain(0)
    expect(values).toContain(22.1)
    expect(values).toContain(28.4)
    expect(values).toContain("°C")
    expect(values).toContain("Céu limpo")
  })

  it("skips suggestions with an unknown weekday", async () => {
    const { db: writeDb, tx } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits({
      ...BASE_INPUT,
      suggestions: [{ weekday: "funday", clothingPieceIds: ["item-1"] }],
    })

    expect(getSqlStrings(tx).some((s) => /insert into outfits/i.test(s))).toBe(false)
  })

  it("skips suggestions with empty clothing piece IDs", async () => {
    const { db: writeDb, tx } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.saveWeeklyOutfits({
      ...BASE_INPUT,
      suggestions: [{ weekday: "sunday", clothingPieceIds: [] }],
    })

    expect(getSqlStrings(tx).some((s) => /insert into outfits/i.test(s))).toBe(false)
  })

  it("maps all weekdays to correct dayOfWeek values", async () => {
    const weekdays = [
      { name: "sunday", expected: 0 },
      { name: "monday", expected: 1 },
      { name: "tuesday", expected: 2 },
      { name: "wednesday", expected: 3 },
      { name: "thursday", expected: 4 },
      { name: "friday", expected: 5 },
      { name: "saturday", expected: 6 },
    ]

    for (const { name, expected } of weekdays) {
      const { db: writeDb, tx } = makeWriteDb([])
      const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

      await repo.saveWeeklyOutfits({
        ...BASE_INPUT,
        suggestions: [{ weekday: name, clothingPieceIds: ["item-1"] }],
        dayWeatherByWeekday: {
          [name]: {
            weatherSummary: "Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%",
            weatherCode: 0,
            minTemperature: 22,
            maxTemperature: 28,
            unityTemperature: "°C",
            descriptionTemperature: "Céu limpo",
          },
        },
      })

      expect(getInterpolatedValues(tx)).toContain(expected)
    }
  })

  it("returns SavedOutfitRef array with correct outfitId, weekday, clothingPieceIds, and layout", async () => {
    const { db: writeDb } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    const result = await repo.saveWeeklyOutfits(BASE_INPUT)

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)

    const sunday = result.find((r: SavedOutfitRef) => r.weekday === "sunday")
    const monday = result.find((r: SavedOutfitRef) => r.weekday === "monday")

    expect(sunday).toBeDefined()
    expect(sunday?.clothingPieceIds).toEqual(["item-1", "item-2"])
    expect(typeof sunday?.outfitId).toBe("string")
    expect(sunday?.outfitId.length).toBeGreaterThan(0)
    expect(sunday?.layout).toEqual(
      buildOutfitCollageLayout([
        { id: "item-1", pieceType: "Top" },
        { id: "item-2", pieceType: "Bottom" },
      ]),
    )

    expect(monday).toBeDefined()
    expect(monday?.clothingPieceIds).toEqual(["item-3"])
    expect(monday?.layout).toEqual(
      buildOutfitCollageLayout([{ id: "item-3", pieceType: "Footwear" }]),
    )
  })

  it("returns an empty array when all suggestions are skipped", async () => {
    const { db: writeDb } = makeWriteDb([])
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    const result = await repo.saveWeeklyOutfits({
      ...BASE_INPUT,
      suggestions: [{ weekday: "funday", clothingPieceIds: ["item-1"] }],
    })

    expect(result).toEqual([])
  })
})

describe("SqlWeeklyOutfitsRepository.updateOutfitImageUrl()", () => {
  it("updates outfits.image_url for the given outfit id", async () => {
    const { db: writeDb } = makeWriteDb([])
    const writeMock = writeDb as unknown as ReturnType<typeof vi.fn>
    const repo = new SqlWeeklyOutfitsRepository(makeUnusedReadDb(), writeDb)

    await repo.updateOutfitImageUrl("outfit-1", "https://r2.example.com/outfits/outfit-1.png")

    expect(getSqlStrings(writeMock).some((s) => /update outfits/i.test(s))).toBe(true)
    expect(getInterpolatedValues(writeMock)).toContain("https://r2.example.com/outfits/outfit-1.png")
    expect(getInterpolatedValues(writeMock)).toContain("outfit-1")
  })
})
