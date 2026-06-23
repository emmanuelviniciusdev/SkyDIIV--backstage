import { describe, it, expect } from "vitest"
import { buildWeeklyOutfitsPromptStep } from "../../src/workflows/sync-language/steps/weekly-outfits/build-prompt"
import { buildWardrobePanoramaPromptStep } from "../../src/workflows/sync-language/steps/wardrobe-panorama/build-prompt"

describe("buildWeeklyOutfitsPromptStep", () => {
  it("returns a single prompt for the weekly_outfits translation flow", () => {
    const result = buildWeeklyOutfitsPromptStep({
      userId: "user-123",
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

    expect(result.prompt).toContain("weekly_outfits")
    expect(result.prompt).toContain('do idioma "en-US" para "pt-BR"')
    expect(result.records).toHaveLength(1)
  })
})

describe("buildWardrobePanoramaPromptStep", () => {
  it("returns a single prompt for the wardrobe_panorama translation flow", () => {
    const result = buildWardrobePanoramaPromptStep({
      userId: "user-123",
      oldLanguage: "en-US",
      newLanguage: "es-PE",
      record: {
        id: "22222222-2222-2222-2222-222222222222",
        content: "## Analysis",
      },
    })

    expect(result.prompt).toContain("wardrobe_panorama")
    expect(result.prompt).toContain('do idioma "en-US" para "es-PE"')
    expect(result.record.id).toBe("22222222-2222-2222-2222-222222222222")
  })
})
