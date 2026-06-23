/**
 * Integration tests for the sync-language workflow steps.
 *
 * Each translation flow runs build-prompt → execute-prompt → save as separate steps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => {
  const USER_ID = "user-integration-test"

  const weeklyOutfitRows = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      weather_summary: "Clear sky, max 28°C",
      description_temperature: "Warm day",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      weather_summary: "Light rain",
      description_temperature: null,
    },
  ]

  const wardrobePanoramaRow = {
    id: "33333333-3333-3333-3333-333333333333",
    content: "## Wardrobe\nBalanced closet.",
  }

  const readDb = vi.fn().mockImplementation((strings: TemplateStringsArray | string[]) => {
    const query = Array.isArray(strings) ? strings.join("") : String(strings)
    if (query.includes("weekly_outfits")) return Promise.resolve(weeklyOutfitRows)
    if (query.includes("wardrobe_panorama")) return Promise.resolve([wardrobePanoramaRow])
    return Promise.resolve([])
  })

  const writeDb = vi.fn().mockResolvedValue([])

  const llmGenerate = vi.fn().mockImplementation(async (prompt: string) => {
    if (prompt.includes("weekly_outfits")) {
      return JSON.stringify([
        {
          id: "11111111-1111-1111-1111-111111111111",
          weather_summary: "Céu limpo, máx. 28°C",
          description_temperature: "Dia quente",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          weather_summary: "Chuva leve",
          description_temperature: null,
        },
      ])
    }
    if (prompt.includes("wardrobe_panorama")) {
      return JSON.stringify({
        id: "33333333-3333-3333-3333-333333333333",
        content: "## Guarda-roupa\nCloset equilibrado.",
      })
    }
    throw new Error("Unexpected prompt")
  })

  return {
    USER_ID,
    weeklyOutfitRows,
    wardrobePanoramaRow,
    readDb,
    writeDb,
    llmGenerate,
  }
})

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.readDb,
  getWriteDb: () => mocks.writeDb,
  resetDbClients: vi.fn(),
}))

vi.mock("../../src/lib/llm", () => ({
  getLlmProvider: () => ({
    name: "gemini:test",
    generate: mocks.llmGenerate,
  }),
}))

import { loadTranslatableRecordsStep } from "../../src/workflows/sync-language/steps/load-translatable-records"
import { buildWeeklyOutfitsPromptStep } from "../../src/workflows/sync-language/steps/weekly-outfits/build-prompt"
import { saveWeeklyOutfitsTranslationsStep } from "../../src/workflows/sync-language/steps/weekly-outfits/save-translations"
import { buildWardrobePanoramaPromptStep } from "../../src/workflows/sync-language/steps/wardrobe-panorama/build-prompt"
import { saveWardrobePanoramaTranslationStep } from "../../src/workflows/sync-language/steps/wardrobe-panorama/save-translation"
import { executePromptStep } from "../../src/lib/llm/execute-prompt"

describe("sync-language workflow steps (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("loads weekly_outfits and wardrobe_panorama records for the user", async () => {
    const records = await loadTranslatableRecordsStep(mocks.USER_ID)

    expect(records.weeklyOutfits).toHaveLength(2)
    expect(records.wardrobePanorama).toEqual(mocks.wardrobePanoramaRow)
  })

  it("runs the weekly_outfits flow with one prompt build, one LLM call, and one save", async () => {
    const promptData = buildWeeklyOutfitsPromptStep({
      userId: mocks.USER_ID,
      oldLanguage: "en-US",
      newLanguage: "pt-BR",
      records: mocks.weeklyOutfitRows,
    })

    const llmResult = await executePromptStep({
      userId: promptData.userId,
      prompt: promptData.prompt,
      step: "weekly-outfits-execute-prompt",
    })

    const saveResult = await saveWeeklyOutfitsTranslationsStep({
      userId: promptData.userId,
      sourceRecords: promptData.records,
      rawResponse: llmResult.response,
    })

    expect(saveResult.translatedCount).toBe(2)
    expect(mocks.llmGenerate).toHaveBeenCalledOnce()
    expect(mocks.writeDb).toHaveBeenCalledTimes(3)
  })

  it("runs the wardrobe_panorama flow with one prompt build, one LLM call, and one save", async () => {
    const promptData = buildWardrobePanoramaPromptStep({
      userId: mocks.USER_ID,
      oldLanguage: "en-US",
      newLanguage: "pt-BR",
      record: mocks.wardrobePanoramaRow,
    })

    const llmResult = await executePromptStep({
      userId: promptData.userId,
      prompt: promptData.prompt,
      step: "wardrobe-panorama-execute-prompt",
    })

    const saveResult = await saveWardrobePanoramaTranslationStep({
      userId: promptData.userId,
      sourceRecord: promptData.record,
      rawResponse: llmResult.response,
    })

    expect(saveResult.translated).toBe(true)
    expect(mocks.llmGenerate).toHaveBeenCalledOnce()
    expect(mocks.writeDb).toHaveBeenCalledTimes(2)
  })
})
