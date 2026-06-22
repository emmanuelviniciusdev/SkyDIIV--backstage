import { describe, it, expect } from "vitest"
import { buildWeeklyOutfitsPrompt } from "../../../src/lib/i18n/prompts/weekly-outfits"
import type { WardrobeItem } from "../../../src/lib/db/wardrobe.repository"
import type { WeeklyForecast } from "../../../src/lib/weather/types"

const WARDROBE: WardrobeItem[] = [
  { id: "item-1", title: "White T-Shirt", imageUrl: null, tags: ["casual", "summer"] },
]

const FORECAST: WeeklyForecast = {
  location: "Lima, Perú",
  days: [
    { date: "2026-06-07", maxTempC: 24, minTempC: 18, precipitationProbability: 5, weatherCode: 0 },
  ],
}

describe("buildWeeklyOutfitsPrompt()", () => {
  it("builds pt-BR prompt with Portuguese instructions", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "pt-BR",
      wardrobe: WARDROBE,
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("assistente de moda do SkyDIIV")
    expect(prompt).toContain("ID:item-1 | TÍTULO:White T-Shirt | TAGS:casual, summer")
    expect(prompt).toContain("Estilo casual")
    expect(prompt).toContain("Localização: Lima, Perú")
  })

  it("builds es-PE prompt with Spanish instructions", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "es-PE",
      wardrobe: WARDROBE,
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("asistente de moda de SkyDIIV")
    expect(prompt).toContain("ID:item-1 | TÍTULO:White T-Shirt | ETIQUETAS:casual, summer")
    expect(prompt).toContain("Ubicación: Lima, Perú")
  })

  it("builds en-US prompt with English instructions", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "en-US",
      wardrobe: WARDROBE,
      preferences: "Casual style",
      forecast: FORECAST,
    })

    expect(prompt).toContain("SkyDIIV fashion assistant")
    expect(prompt).toContain("ID:item-1 | TITLE:White T-Shirt | TAGS:casual, summer")
    expect(prompt).toContain("Location: Lima, Perú")
  })
})
