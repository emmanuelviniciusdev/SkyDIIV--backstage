import { describe, it, expect } from "vitest"
import { buildSyncWeeklyOutfitsPrompt } from "../../src/lib/i18n/prompts/sync-weekly-outfits"

describe("buildSyncWeeklyOutfitsPrompt", () => {
  it("includes source/target languages and record data in Portuguese instructions", () => {
    const prompt = buildSyncWeeklyOutfitsPrompt({
      oldLanguage: "en-US",
      newLanguage: "pt-BR",
      records: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          weather_summary: "Clear sky",
          description_temperature: "Warm day",
        },
      ],
    })

    expect(prompt).toContain('do idioma "en-US" para "pt-BR"')
    expect(prompt).toContain("weekly_outfits")
    expect(prompt).toContain("weather_summary")
    expect(prompt).toContain("description_temperature")
    expect(prompt).toContain("11111111-1111-1111-1111-111111111111")
    expect(prompt).toContain("Clear sky")
    expect(prompt).toContain("Warm day")
  })
})
