import { describe, it, expect } from "vitest"
import {
  buildPrompt,
  formatWeatherForecast,
  formatDayWeatherSummary,
  weatherCodeDescription,
  parseOutfitSuggestions,
} from "../../src/lib/prompt/builder"
import type { WardrobeItem } from "../../src/lib/db/wardrobe.repository"
import type { WeeklyForecast, DailyWeather } from "../../src/lib/weather/types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WARDROBE: WardrobeItem[] = [
  { id: "item-1", title: "White T-Shirt", imageUrl: "https://r2.example.com/shirt.jpg", tags: ["casual", "summer", "white", "cotton"] },
  { id: "item-2", title: "Black Jeans", imageUrl: null, tags: ["casual", "all-season", "black", "denim"] },
  { id: "item-3", title: "Blue Sneakers", imageUrl: null, tags: ["casual", "shoes", "blue"] },
]

const FORECAST: WeeklyForecast = {
  location: "Rio de Janeiro, Rio de Janeiro, Brasil",
  days: [
    { date: "2026-06-07", maxTempC: 28, minTempC: 22, precipitationProbability: 10, weatherCode: 0 },
    { date: "2026-06-08", maxTempC: 27, minTempC: 21, precipitationProbability: 30, weatherCode: 2 },
    { date: "2026-06-09", maxTempC: 25, minTempC: 20, precipitationProbability: 60, weatherCode: 61 },
    { date: "2026-06-10", maxTempC: 24, minTempC: 19, precipitationProbability: 80, weatherCode: 63 },
    { date: "2026-06-11", maxTempC: 26, minTempC: 21, precipitationProbability: 20, weatherCode: 1 },
    { date: "2026-06-12", maxTempC: 28, minTempC: 22, precipitationProbability: 10, weatherCode: 0 },
    { date: "2026-06-13", maxTempC: 29, minTempC: 23, precipitationProbability: 5, weatherCode: 0 },
  ],
}

// ---------------------------------------------------------------------------
// weatherCodeDescription()
// ---------------------------------------------------------------------------

describe("weatherCodeDescription()", () => {
  it("describes code 0 as 'Céu limpo'", () => {
    expect(weatherCodeDescription(0)).toBe("Céu limpo")
  })

  it("describes code 2 as 'Parcialmente nublado'", () => {
    expect(weatherCodeDescription(2)).toBe("Parcialmente nublado")
  })

  it("describes code 3 as 'Nublado'", () => {
    expect(weatherCodeDescription(3)).toBe("Nublado")
  })

  it("describes code 61 as 'Chuva'", () => {
    expect(weatherCodeDescription(61)).toBe("Chuva")
  })

  it("describes code 95 as 'Trovoada'", () => {
    expect(weatherCodeDescription(95)).toBe("Trovoada")
  })

  it("falls back to 'Tempo variável' for unknown codes", () => {
    expect(weatherCodeDescription(999)).toBe("Tempo variável")
  })
})

// ---------------------------------------------------------------------------
// formatDayWeatherSummary()
// ---------------------------------------------------------------------------

describe("formatDayWeatherSummary()", () => {
  const DAY: DailyWeather = {
    date: "2026-06-07",
    maxTempC: 28.4,
    minTempC: 22.1,
    precipitationProbability: 10,
    weatherCode: 0,
  }

  it("returns a pt-BR summary with rounded temperatures", () => {
    const result = formatDayWeatherSummary(DAY)
    expect(result).toBe("Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%")
  })

  it("includes the WMO weather description", () => {
    const rainy: DailyWeather = { ...DAY, weatherCode: 61 }
    expect(formatDayWeatherSummary(rainy)).toContain("Chuva")
  })
})

// ---------------------------------------------------------------------------
// buildPrompt()
// ---------------------------------------------------------------------------

describe("buildPrompt()", () => {
  it("includes each wardrobe item in the expected format", () => {
    const prompt = buildPrompt({ wardrobe: WARDROBE, preferences: "Casual wear", forecast: FORECAST })

    expect(prompt).toContain("ID:item-1 | TÍTULO:White T-Shirt | TAGS:casual, summer, white, cotton")
    expect(prompt).toContain("ID:item-2 | TÍTULO:Black Jeans | TAGS:casual, all-season, black, denim")
    expect(prompt).toContain("ID:item-3 | TÍTULO:Blue Sneakers | TAGS:casual, shoes, blue")
  })

  it("includes the user preferences in the prompt", () => {
    const prompt = buildPrompt({ wardrobe: WARDROBE, preferences: "I prefer casual clothing", forecast: FORECAST })
    expect(prompt).toContain("I prefer casual clothing")
  })

  it("includes the formatted weather forecast in pt-BR", () => {
    const prompt = buildPrompt({ wardrobe: WARDROBE, preferences: "Any", forecast: FORECAST })
    expect(prompt).toContain("Rio de Janeiro, Rio de Janeiro, Brasil")
    expect(prompt).toContain("máx. 28°C")
    expect(prompt).toContain("chuva: 10%")
  })

  it("falls back gracefully when wardrobe is empty", () => {
    const prompt = buildPrompt({ wardrobe: [], preferences: "Any", forecast: FORECAST })
    expect(prompt).toContain("No wardrobe items available.")
  })

  it("falls back gracefully when preferences is empty", () => {
    const prompt = buildPrompt({ wardrobe: WARDROBE, preferences: "", forecast: FORECAST })
    expect(prompt).toContain("No specific preferences provided.")
  })

  it("falls back gracefully when forecast days list is empty", () => {
    const emptyForecast: WeeklyForecast = { location: "Somewhere", days: [] }
    const prompt = buildPrompt({ wardrobe: WARDROBE, preferences: "Any", forecast: emptyForecast })
    expect(prompt).toContain("Localização: Somewhere")
  })

  it("uses 'no tags' placeholder when a wardrobe item has no tags", () => {
    const items: WardrobeItem[] = [{ id: "x1", title: "Mystery Item", imageUrl: null, tags: [] }]
    const prompt = buildPrompt({ wardrobe: items, preferences: "Any", forecast: FORECAST })
    expect(prompt).toContain("ID:x1 | TÍTULO:Mystery Item | TAGS:no tags")
  })
})

// ---------------------------------------------------------------------------
// formatWeatherForecast()
// ---------------------------------------------------------------------------

describe("formatWeatherForecast()", () => {
  it("includes the pt-BR location header", () => {
    const result = formatWeatherForecast(FORECAST)
    expect(result).toContain("Localização: Rio de Janeiro, Rio de Janeiro, Brasil")
  })

  it("includes all 7 days", () => {
    const result = formatWeatherForecast(FORECAST)
    const lines = result.split("\n").filter((l) => l.startsWith("-"))
    expect(lines).toHaveLength(7)
  })

  it("formats temperature in pt-BR with rounded values", () => {
    const result = formatWeatherForecast(FORECAST)
    expect(result).toContain("máx. 28°C / mín. 22°C")
    expect(result).toContain("chuva: 10%")
  })

  it("uses pt-BR weekday names", () => {
    const result = formatWeatherForecast(FORECAST)
    // 2026-06-07 is a Sunday — in pt-BR: "Domingo"
    expect(result).toContain("Domingo")
  })
})

// ---------------------------------------------------------------------------
// parseOutfitSuggestions()
// ---------------------------------------------------------------------------

describe("parseOutfitSuggestions()", () => {
  const VALID_JSON = JSON.stringify([
    { weekday: "sunday", clothing_piece_ids: ["item-1", "item-2"] },
    { weekday: "monday", clothing_piece_ids: ["item-1", "item-3"] },
    { weekday: "tuesday", clothing_piece_ids: ["item-2", "item-3"] },
    { weekday: "wednesday", clothing_piece_ids: ["item-1"] },
    { weekday: "thursday", clothing_piece_ids: ["item-2"] },
    { weekday: "friday", clothing_piece_ids: ["item-3"] },
    { weekday: "saturday", clothing_piece_ids: ["item-1", "item-2", "item-3"] },
  ])

  it("parses a valid LLM response", () => {
    const result = parseOutfitSuggestions(VALID_JSON)
    expect(result).toHaveLength(7)
    expect(result[0]).toEqual({ weekday: "sunday", clothingPieceIds: ["item-1", "item-2"] })
  })

  it("strips markdown code fences before parsing", () => {
    const withFences = "```json\n" + VALID_JSON + "\n```"
    const result = parseOutfitSuggestions(withFences)
    expect(result).toHaveLength(7)
  })

  it("strips plain code fences before parsing", () => {
    const withFences = "```\n" + VALID_JSON + "\n```"
    const result = parseOutfitSuggestions(withFences)
    expect(result).toHaveLength(7)
  })

  it("normalises weekday to lowercase", () => {
    const mixedCase = JSON.stringify([
      { weekday: "SUNDAY", clothing_piece_ids: ["item-1"] },
      { weekday: "Monday", clothing_piece_ids: ["item-2"] },
      { weekday: "tuesday", clothing_piece_ids: ["item-3"] },
      { weekday: "wednesday", clothing_piece_ids: ["item-1"] },
      { weekday: "thursday", clothing_piece_ids: ["item-2"] },
      { weekday: "friday", clothing_piece_ids: ["item-3"] },
      { weekday: "saturday", clothing_piece_ids: ["item-1"] },
    ])
    const result = parseOutfitSuggestions(mixedCase)
    expect(result[0].weekday).toBe("sunday")
    expect(result[1].weekday).toBe("monday")
  })

  it("throws when the response is not valid JSON", () => {
    expect(() => parseOutfitSuggestions("not json")).toThrow("LLM response is not valid JSON")
  })

  it("throws when the response does not match the expected schema", () => {
    const wrongSchema = JSON.stringify([{ day: "sunday", pieces: [] }])
    expect(() => parseOutfitSuggestions(wrongSchema)).toThrow("LLM response does not match expected schema")
  })
})
