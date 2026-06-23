import { describe, it, expect } from "vitest"
import { buildSyncWardrobePanoramaPrompt } from "../../src/lib/i18n/prompts/sync-wardrobe-panorama"

describe("buildSyncWardrobePanoramaPrompt", () => {
  it("includes source/target languages and panorama content in Portuguese instructions", () => {
    const prompt = buildSyncWardrobePanoramaPrompt({
      oldLanguage: "en-US",
      newLanguage: "es-PE",
      record: {
        id: "22222222-2222-2222-2222-222222222222",
        content: "## Wardrobe analysis\nYour closet is well balanced.",
      },
    })

    expect(prompt).toContain('do idioma "en-US" para "es-PE"')
    expect(prompt).toContain("wardrobe_panorama")
    expect(prompt).toContain("22222222-2222-2222-2222-222222222222")
    expect(prompt).toContain("Wardrobe analysis")
  })
})
