import { describe, it, expect, vi } from "vitest"
import { SqlWeeklyOutfitsRepository } from "../../src/lib/db/weekly-outfits.repository"
import type postgres from "postgres"
import type { SavedOutfitRef } from "../../src/lib/db/weekly-outfits.repository"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SqlMock = ReturnType<typeof vi.fn> & { begin?: ReturnType<typeof vi.fn> }

function makeReadDb(existingOutfitIds: string[] = []): postgres.Sql {
  const rows = existingOutfitIds.map((id) => ({ outfit_id: id }))
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql
}

function makeWriteDb(): { db: postgres.Sql; tx: ReturnType<typeof vi.fn> } {
  const tx = vi.fn().mockResolvedValue([])
  const db = vi.fn().mockResolvedValue([]) as unknown as SqlMock
  db.begin = vi.fn().mockImplementation(
    async (fn: (t: ReturnType<typeof vi.fn>) => Promise<unknown>) => {
      // Return the callback's result so callers that capture the begin() return
      // value (e.g. saveWeeklyOutfits returning SavedOutfitRef[]) work correctly.
      return await fn(tx)
    },
  )
  return { db: db as unknown as postgres.Sql, tx }
}

/** Flattened list of all template-string segments from every tagged-template call on a mock. */
function getSqlStrings(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
    return []
  })
}

/** Flattened interpolated values (positions 1…n) from every call on a mock. */
function getInterpolatedValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.flatMap((call) => call.slice(1))
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
      minTemperature: 22.1,
      maxTemperature: 28.4,
      unityTemperature: "°C",
      descriptionTemperature: "Céu limpo",
    },
    monday: {
      weatherSummary: "Parcialmente nublado, máx. 27°C / mín. 21°C, chuva: 30%",
      minTemperature: 21,
      maxTemperature: 27,
      unityTemperature: "°C",
      descriptionTemperature: "Parcialmente nublado",
    },
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SqlWeeklyOutfitsRepository.saveWeeklyOutfits()", () => {
  it("does not issue a DELETE when no existing records are found", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb, tx } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    expect(getSqlStrings(tx).some((s) => /delete/i.test(s))).toBe(false)
  })

  it("issues a DELETE when existing outfit IDs are found", async () => {
    const readDb = makeReadDb(["old-outfit-1", "old-outfit-2"])
    const { db: writeDb, tx } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    expect(getSqlStrings(tx).some((s) => /delete/i.test(s))).toBe(true)
    // IDs are passed as a single array interpolation value
    const values = getInterpolatedValues(tx)
    const hasIds = values.some(
      (v) => Array.isArray(v) && v.includes("old-outfit-1") && v.includes("old-outfit-2"),
    )
    expect(hasIds).toBe(true)
  })

  it("runs everything inside a transaction", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    expect((writeDb as unknown as SqlMock).begin).toHaveBeenCalledOnce()
  })

  it("stores weather fields in the weekly_outfits insert", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb, tx } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.saveWeeklyOutfits(BASE_INPUT)

    const values = getInterpolatedValues(tx)
    expect(values).toContain("Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%")
    expect(values).toContain(22.1)
    expect(values).toContain(28.4)
    expect(values).toContain("°C")
    expect(values).toContain("Céu limpo")
  })

  it("skips suggestions with an unknown weekday", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb, tx } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.saveWeeklyOutfits({
      ...BASE_INPUT,
      suggestions: [{ weekday: "funday", clothingPieceIds: ["item-1"] }],
    })

    expect(getSqlStrings(tx).some((s) => /insert into outfits/i.test(s))).toBe(false)
  })

  it("skips suggestions with empty clothing piece IDs", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb, tx } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

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
      const readDb = makeReadDb([])
      const { db: writeDb, tx } = makeWriteDb()
      const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

      await repo.saveWeeklyOutfits({
        ...BASE_INPUT,
        suggestions: [{ weekday: name, clothingPieceIds: ["item-1"] }],
        dayWeatherByWeekday: {
          [name]: {
            weatherSummary: "Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%",
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

  it("returns SavedOutfitRef array with correct outfitId, weekday, and clothingPieceIds", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    const result = await repo.saveWeeklyOutfits(BASE_INPUT)

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)

    const sunday = result.find((r: SavedOutfitRef) => r.weekday === "sunday")
    const monday = result.find((r: SavedOutfitRef) => r.weekday === "monday")

    expect(sunday).toBeDefined()
    expect(sunday?.clothingPieceIds).toEqual(["item-1", "item-2"])
    expect(typeof sunday?.outfitId).toBe("string")
    expect(sunday?.outfitId.length).toBeGreaterThan(0)

    expect(monday).toBeDefined()
    expect(monday?.clothingPieceIds).toEqual(["item-3"])
  })

  it("returns an empty array when all suggestions are skipped", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    const result = await repo.saveWeeklyOutfits({
      ...BASE_INPUT,
      suggestions: [{ weekday: "funday", clothingPieceIds: ["item-1"] }],
    })

    expect(result).toEqual([])
  })
})

describe("SqlWeeklyOutfitsRepository.updateOutfitImageUrl()", () => {
  it("issues an UPDATE with the correct outfit ID and image URL", async () => {
    const readDb = makeReadDb([])
    const { db: writeDb } = makeWriteDb()
    const repo = new SqlWeeklyOutfitsRepository(readDb, writeDb)

    await repo.updateOutfitImageUrl("outfit-abc", "https://r2.example.com/outfits/outfit-abc.jpg")

    const writeMock = writeDb as unknown as ReturnType<typeof vi.fn>
    const sqlStrings = writeMock.mock.calls.flatMap((call: unknown[]) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
      return []
    })
    expect(sqlStrings.some((s: string) => /update outfits/i.test(s))).toBe(true)
    expect(sqlStrings.some((s: string) => /image_url/i.test(s))).toBe(true)

    const values = writeMock.mock.calls.flatMap((call: unknown[]) => call.slice(1))
    expect(values).toContain("outfit-abc")
    expect(values).toContain("https://r2.example.com/outfits/outfit-abc.jpg")
  })
})
