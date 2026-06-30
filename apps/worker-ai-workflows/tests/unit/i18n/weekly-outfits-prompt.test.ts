import { describe, it, expect } from "vitest"
import { buildWeeklyOutfitsPrompt } from "../../../src/lib/i18n/prompts/weekly-outfits"
import type { WardrobeItem } from "../../../src/lib/db/wardrobe.repository"
import type { WeeklyForecast } from "../../../src/lib/weather/types"

const WARDROBE: WardrobeItem[] = [
  { id: "item-1", title: "White T-Shirt", imageUrl: null, tags: ["casual", "summer"], pieceType: "Top", pieceSubtype: "T-Shirt" },
  { id: "item-2", title: "Black Jeans", imageUrl: null, tags: ["casual"], pieceType: "Bottom", pieceSubtype: "Jeans" },
  { id: "item-3", title: "Blue Shirt", imageUrl: null, tags: ["formal"], pieceType: "Top", pieceSubtype: "Shirt" },
]

const FORECAST: WeeklyForecast = {
  location: "Lima, Perú",
  days: [
    { date: "2026-06-07", maxTempC: 24, minTempC: 18, precipitationProbability: 5, weatherCode: 0 },
  ],
}

describe("buildWeeklyOutfitsPrompt()", () => {
  it("always builds prompt with pt-BR instructions regardless of locale", () => {
    for (const locale of ["pt-BR", "es-PE", "en-US"] as const) {
      const prompt = buildWeeklyOutfitsPrompt({
        locale,
        wardrobe: WARDROBE,
        preferences: "Estilo casual",
        forecast: FORECAST,
      })

      expect(prompt).toContain("assistente de moda do SkyDIIV")
      expect(prompt).toContain("TÍTULO:")
      expect(prompt).toContain("TIPO:")
      expect(prompt).toContain("SUBTIPO:")
      expect(prompt).toContain("TAGS:")
      expect(prompt).toContain("fornecidos em inglês (en-US)")
    }
  })

  it("includes wardrobe items in pt-BR format with en-US type/subtype values", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "pt-BR",
      wardrobe: WARDROBE,
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("ID:item-1 | TÍTULO:White T-Shirt | TIPO:Top | SUBTIPO:T-Shirt | TAGS:casual, summer")
    expect(prompt).toContain("ID:item-2 | TÍTULO:Black Jeans | TIPO:Bottom | SUBTIPO:Jeans | TAGS:casual")
  })

  it("uses pt-BR wardrobe item format even for non-pt-BR locales", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "en-US",
      wardrobe: WARDROBE,
      preferences: "Casual style",
      forecast: FORECAST,
    })

    expect(prompt).toContain("TÍTULO:")
    expect(prompt).not.toContain("TITLE:")
    expect(prompt).toContain("TIPO:")
    expect(prompt).not.toContain("TYPE:")
  })

  it("includes wardrobe summary grouped by type and subtype", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "pt-BR",
      wardrobe: WARDROBE,
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("Resumo por tipo")
    expect(prompt).toContain("Top: 2 peças → T-Shirt (1), Shirt (1)")
    expect(prompt).toContain("Bottom: 1 peça → Jeans (1)")
    expect(prompt).toContain("Total: 3 peças")
  })

  it("includes preferences and weather forecast", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "pt-BR",
      wardrobe: WARDROBE,
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("Estilo casual")
    expect(prompt).toContain("Lima, Perú")
  })

  it("uses pt-BR weather formatting regardless of locale", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "en-US",
      wardrobe: WARDROBE,
      preferences: "Casual style",
      forecast: FORECAST,
    })

    expect(prompt).toContain("Localização: Lima, Perú")
  })

  it("uses pt-BR fallback when preferences are empty", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "pt-BR",
      wardrobe: WARDROBE,
      preferences: "  ",
      forecast: FORECAST,
    })

    expect(prompt).toContain("Nenhuma preferência específica informada.")
  })

  it("uses pt-BR fallback when wardrobe is empty", () => {
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "pt-BR",
      wardrobe: [],
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("Nenhuma peça disponível no guarda-roupa.")
  })

  it("item titles can be in user language — not translated by the prompt", () => {
    const wardrobe: WardrobeItem[] = [
      { id: "x1", title: "Camisa blanca", imageUrl: null, tags: ["formal"], pieceType: "Top", pieceSubtype: "Shirt" },
    ]
    const prompt = buildWeeklyOutfitsPrompt({
      locale: "es-PE",
      wardrobe,
      preferences: "Estilo casual",
      forecast: FORECAST,
    })

    expect(prompt).toContain("TÍTULO:Camisa blanca")
    expect(prompt).toContain("TIPO:Top")
    expect(prompt).toContain("SUBTIPO:Shirt")
  })
})
