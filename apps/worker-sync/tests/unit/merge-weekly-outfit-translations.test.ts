import { describe, it, expect } from "vitest"
import { mergeWeeklyOutfitTranslations } from "../../src/workflows/sync-language/steps/weekly-outfits/save-translations"

describe("mergeWeeklyOutfitTranslations", () => {
  const sourceRecords = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      weather_summary: "Clear sky",
      description_temperature: null,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      weather_summary: null,
      description_temperature: "Warm day",
    },
  ]

  it("keeps null source fields null even when LLM returns values", () => {
    const updates = mergeWeeklyOutfitTranslations(sourceRecords, [
      {
        id: "11111111-1111-1111-1111-111111111111",
        weather_summary: "Céu limpo",
        description_temperature: "Dia quente",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        weather_summary: "Ignored",
        description_temperature: "Dia quente",
      },
    ])

    expect(updates).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        weather_summary: "Céu limpo",
        description_temperature: null,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        weather_summary: null,
        description_temperature: "Dia quente",
      },
    ])
  })

  it("throws when LLM returns an unknown id", () => {
    expect(() =>
      mergeWeeklyOutfitTranslations(sourceRecords, [
        {
          id: "33333333-3333-3333-3333-333333333333",
          weather_summary: "X",
          description_temperature: "Y",
        },
      ]),
    ).toThrow("unknown weekly_outfits id")
  })

  it("throws when translation count does not match source count", () => {
    expect(() =>
      mergeWeeklyOutfitTranslations(sourceRecords, [
        {
          id: "11111111-1111-1111-1111-111111111111",
          weather_summary: "Céu limpo",
          description_temperature: null,
        },
      ]),
    ).toThrow("expected 2")
  })
})
