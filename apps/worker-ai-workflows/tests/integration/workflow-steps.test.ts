/**
 * Integration tests for the workflow steps.
 *
 * External boundaries (DB, LLM, weather API) are replaced by in-memory fakes
 * so these tests run without any real network calls or database connections.
 * The goal is to verify the end-to-end data flow through all steps.
 */
import { describe, it, expect, vi, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// All fixtures and mock objects that need to be referenced inside vi.mock()
// factories must be created with vi.hoisted() — factories are hoisted to the
// top of the file before any module-level variable initialisations run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const USER_ID = "user-integration-test"
  const WEEK_START = "2026-06-07"
  const PREFERENCES_ID = "prefs-integration-test"

  // ── Fake DB rows ───────────────────────────────────────────────────────────

  const fakePreferencesRow = {
    id: PREFERENCES_ID,
    user_id: USER_ID,
    location: "Rio de Janeiro, Rio de Janeiro, Brasil",
    routine_description: "Casual everyday wear, work from home 3 days a week.",
  }

  const fakeWardrobeRows = [
    { id: "item-1", title: "White T-Shirt", image_url: "https://r2.example.com/items/item-1.jpg", tags: ["casual", "summer"], piece_type: "Top", piece_subtype: "T-Shirt" },
    { id: "item-2", title: "Black Jeans", image_url: "https://r2.example.com/items/item-2.jpg", tags: ["casual", "denim"], piece_type: "Bottom", piece_subtype: "Jeans" },
    { id: "item-3", title: "Blue Sneakers", image_url: null, tags: ["shoes", "casual"], piece_type: "Footwear", piece_subtype: "Sneakers" },
  ]

  const fakeForecast = {
    location: "Rio de Janeiro, Rio de Janeiro, Brasil",
    days: Array.from({ length: 7 }, (_, i) => ({
      date: `2026-06-0${7 + i}`,
      maxTempC: 28 - i,
      minTempC: 22 - i,
      precipitationProbability: i * 10,
      weatherCode: 0,
    })),
  }

  const fakeLlmResponse = JSON.stringify([
    { weekday: "sunday", clothing_piece_ids: ["item-1", "item-2"] },
    { weekday: "monday", clothing_piece_ids: ["item-1", "item-3"] },
    { weekday: "tuesday", clothing_piece_ids: ["item-2", "item-3"] },
    { weekday: "wednesday", clothing_piece_ids: ["item-1"] },
    { weekday: "thursday", clothing_piece_ids: ["item-2"] },
    { weekday: "friday", clothing_piece_ids: ["item-3"] },
    { weekday: "saturday", clothing_piece_ids: ["item-1", "item-2", "item-3"] },
  ])

  // ── Fake SQL client ────────────────────────────────────────────────────────

  const fakeLanguageRow = {
    name: "Português (BR)",
  }

  // Read DB: returns different rows depending on which query was issued.
  let scenario: "default" | "no-preferences" | "no-wardrobe" = "default"
  const readDb = vi.fn().mockImplementation((strings: TemplateStringsArray | string[]) => {
    const query = Array.isArray(strings) ? strings.join("") : String(strings)
    if (scenario === "no-preferences" && query.includes("weekly_outfit_preferences")) {
      return Promise.resolve([])
    }
    if (scenario === "no-wardrobe" && query.includes("clothing_items")) {
      return Promise.resolve([])
    }
    if (query.includes("app_preferences")) return Promise.resolve([fakeLanguageRow])
    if (query.includes("weekly_outfit_preferences")) return Promise.resolve([fakePreferencesRow])
    if (query.includes("clothing_items")) return Promise.resolve(fakeWardrobeRows)
    return Promise.resolve([])
  })

  const txMock = vi.fn().mockResolvedValue([])
  const writeDb = vi.fn().mockResolvedValue([]) as ReturnType<typeof vi.fn> & {
    begin: ReturnType<typeof vi.fn>
  }
  writeDb.begin = vi.fn().mockImplementation(
    async (fn: (tx: ReturnType<typeof vi.fn>) => Promise<unknown>) => { return await fn(txMock) },
  )

  const llmGenerate = vi.fn().mockResolvedValue(fakeLlmResponse)

  return {
    USER_ID,
    WEEK_START,
    PREFERENCES_ID,
    fakePreferencesRow,
    fakeWardrobeRows,
    fakeForecast,
    readDb,
    writeDb,
    llmGenerate,
    setScenario: (value: typeof scenario) => {
      scenario = value
    },
    resetScenario: () => {
      scenario = "default"
    },
  }
})

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.readDb,
  getWriteDb: () => mocks.writeDb,
  resetDbClients: vi.fn(),
}))

vi.mock("../../src/lib/weather/index", () => ({
  getWeatherProvider: () => ({
    getForecast: vi.fn().mockResolvedValue(mocks.fakeForecast),
  }),
  registerWeatherProvider: vi.fn(),
}))

vi.mock("../../src/lib/llm/index", () => ({
  getLlmProvider: () => ({
    name: "gemini:gemini-2.5-flash",
    generate: mocks.llmGenerate,
  }),
  registerLlmProvider: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import steps AFTER mocks are registered
// ---------------------------------------------------------------------------

import { buildPromptStep } from "../../src/workflows/generate-weekly-outfits/steps/build-prompt"
import { executePromptStep } from "../../src/workflows/generate-weekly-outfits/steps/execute-prompt"
import { saveOutfitsStep } from "../../src/workflows/generate-weekly-outfits/steps/save-outfits"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Step 1 — buildPromptStep()", () => {
  afterEach(() => {
    mocks.resetScenario()
  })

  it("returns the expected shape", async () => {
    const result = await buildPromptStep(mocks.USER_ID, mocks.WEEK_START)

    expect(result.userId).toBe(mocks.USER_ID)
    expect(result.weeklyOutfitPreferencesId).toBe(mocks.PREFERENCES_ID)
    expect(result.weekStartDate).toBe(mocks.WEEK_START)
    expect(result.locale).toBe("pt-BR")
    expect(typeof result.prompt).toBe("string")
    expect(result.prompt.length).toBeGreaterThan(100)
  })

  it("includes wardrobe item IDs in the prompt", async () => {
    const result = await buildPromptStep(mocks.USER_ID, mocks.WEEK_START)

    expect(result.prompt).toContain("ID:item-1")
    expect(result.prompt).toContain("ID:item-2")
    expect(result.prompt).toContain("ID:item-3")
  })

  it("includes the user's routine description in the prompt", async () => {
    const result = await buildPromptStep(mocks.USER_ID, mocks.WEEK_START)
    expect(result.prompt).toContain("Casual everyday wear")
  })

  it("includes the weather location in the prompt", async () => {
    const result = await buildPromptStep(mocks.USER_ID, mocks.WEEK_START)
    expect(result.prompt).toContain("Rio de Janeiro")
  })

  it("builds dayWeatherByWeekday from the forecast", async () => {
    const result = await buildPromptStep(mocks.USER_ID, mocks.WEEK_START)

    expect(result.dayWeatherByWeekday.sunday).toEqual({
      weatherSummary: "Céu limpo, máx. 28°C / mín. 22°C, chuva: 0%",
      weatherCode: 0,
      minTemperature: 22,
      maxTemperature: 28,
      unityTemperature: "°C",
      descriptionTemperature: "Céu limpo",
    })
  })

  it("throws when the user has no preferences", async () => {
    mocks.setScenario("no-preferences")

    await expect(buildPromptStep("unknown-user", mocks.WEEK_START)).rejects.toThrow(
      "No weekly outfit preferences found",
    )
  })

  it("throws when the user has no wardrobe items", async () => {
    mocks.setScenario("no-wardrobe")

    await expect(buildPromptStep(mocks.USER_ID, mocks.WEEK_START)).rejects.toThrow(
      "has no wardrobe items",
    )
  })
})

describe("Step 2 — executePromptStep()", () => {
  it("returns 7 parsed outfit suggestions", async () => {
    const result = await executePromptStep({ userId: mocks.USER_ID, prompt: "test prompt" })
    expect(result).toHaveLength(7)
  })

  it("maps clothing_piece_ids to clothingPieceIds", async () => {
    const result = await executePromptStep({ userId: mocks.USER_ID, prompt: "test prompt" })
    expect(result[0].weekday).toBe("sunday")
    expect(result[0].clothingPieceIds).toEqual(["item-1", "item-2"])
  })

  it("logs the LLM interaction to the write DB on success", async () => {
    mocks.writeDb.mockClear()
    await executePromptStep({ userId: mocks.USER_ID, prompt: "test prompt" })

    // The writeDb should have been called for the INSERT into llm_interactions
    expect(mocks.writeDb).toHaveBeenCalled()
    const calls = mocks.writeDb.mock.calls as unknown[][]
    const insertCall = calls.find((args) => {
      const firstArg = (args)[0]
      if (Array.isArray(firstArg)) {
        return firstArg.some((s: unknown) => typeof s === "string" && /insert into llm_interactions/i.test(s))
      }
      return false
    })
    expect(insertCall).toBeDefined()
  })

  it("logs an ERROR and re-throws when the LLM fails", async () => {
    mocks.llmGenerate.mockRejectedValueOnce(new Error("LLM unavailable"))
    mocks.writeDb.mockClear()

    await expect(
      executePromptStep({ userId: mocks.USER_ID, prompt: "test prompt" }),
    ).rejects.toThrow("LLM unavailable")

    const calls = mocks.writeDb.mock.calls as unknown[][]
    const insertCall = calls.find((args) => {
      const firstArg = (args)[0]
      if (Array.isArray(firstArg)) {
        return firstArg.some((s: unknown) => typeof s === "string" && /insert into llm_interactions/i.test(s))
      }
      return false
    })
    expect(insertCall).toBeDefined()
    const allValues = calls.flat()
    expect(allValues).toContain("ERROR")
  })
})

describe("Step 3 — saveOutfitsStep()", () => {
  it("returns a SavedOutfitRef array for valid input", async () => {
    const suggestions = [
      { weekday: "sunday", clothingPieceIds: ["item-1", "item-2"] },
      { weekday: "monday", clothingPieceIds: ["item-3"] },
    ]

    const result = await saveOutfitsStep({
      userId: mocks.USER_ID,
      weeklyOutfitPreferencesId: mocks.PREFERENCES_ID,
      weekStartDate: mocks.WEEK_START,
      suggestions,
      dayWeatherByWeekday: {
        sunday: {
          weatherSummary: "Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%",
          weatherCode: 0,
          minTemperature: 22,
          maxTemperature: 28,
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
      validClothingItemIds: ["item-1", "item-2", "item-3"],
    })

    expect(Array.isArray(result)).toBe(true)
    // The mock tx returns [] for all queries, so the returned refs may be empty
    // in the mock environment — what matters is the step doesn't throw.
  })
})

describe("Full pipeline (Step 1 → 2 → 3)", () => {
  it("produces saved outfit data without errors", async () => {
    const promptData = await buildPromptStep(mocks.USER_ID, mocks.WEEK_START)

    expect(promptData.validClothingItemIds).toEqual(["item-1", "item-2", "item-3"])

    const suggestions = await executePromptStep({
      userId: promptData.userId,
      prompt: promptData.prompt,
    })
    const savedOutfits = await saveOutfitsStep({
      userId: promptData.userId,
      weeklyOutfitPreferencesId: promptData.weeklyOutfitPreferencesId,
      weekStartDate: promptData.weekStartDate,
      suggestions,
      dayWeatherByWeekday: promptData.dayWeatherByWeekday,
      validClothingItemIds: promptData.validClothingItemIds,
    })

    expect(suggestions).toHaveLength(7)
    expect(suggestions.every((s) => s.clothingPieceIds.length > 0)).toBe(true)
    expect(Array.isArray(savedOutfits)).toBe(true)
  })
})
