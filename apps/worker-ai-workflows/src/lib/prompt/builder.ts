import { z } from "zod"
import { DEFAULT_LOCALE, type Locale } from "../i18n/config"
import {
  buildWeeklyOutfitsPrompt,
  formatDayWeatherSummary as formatDayWeatherSummaryI18n,
  formatWeatherForecast as formatWeatherForecastI18n,
  weatherCodeDescription as weatherCodeDescriptionI18n,
} from "../i18n"
import type { WardrobeItem } from "../db/wardrobe.repository"
import type { DailyWeather, WeeklyForecast } from "../weather/types"

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export interface BuildPromptInput {
  locale?: Locale
  wardrobe: WardrobeItem[]
  preferences: string
  forecast: WeeklyForecast
}

/**
 * Builds the full weekly-outfit prompt by interpolating wardrobe items,
 * user preferences, and the 7-day weather forecast into the locale template.
 */
export function buildPrompt(input: BuildPromptInput): string {
  return buildWeeklyOutfitsPrompt({
    locale: input.locale ?? DEFAULT_LOCALE,
    wardrobe: input.wardrobe,
    preferences: input.preferences,
    forecast: input.forecast,
  })
}

export function weatherCodeDescription(code: number, locale: Locale = DEFAULT_LOCALE): string {
  return weatherCodeDescriptionI18n(code, locale)
}

/**
 * Returns a compact, human-readable weather summary for a single day.
 * Stored in the `weather_summary` column of `weekly_outfits`.
 */
export function formatDayWeatherSummary(day: DailyWeather, locale: Locale = DEFAULT_LOCALE): string {
  return formatDayWeatherSummaryI18n(day, locale)
}

/**
 * Formats a WeeklyForecast into a human-readable block for the LLM prompt.
 */
export function formatWeatherForecast(forecast: WeeklyForecast, locale: Locale = DEFAULT_LOCALE): string {
  return formatWeatherForecastI18n(forecast, locale)
}

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

const OutfitSuggestionSchema = z.object({
  weekday: z.string().toLowerCase(),
  clothing_piece_ids: z.array(z.string()),
})

const OutfitSuggestionsSchema = z.array(OutfitSuggestionSchema)

export interface ParsedOutfitSuggestion {
  weekday: string
  clothingPieceIds: string[]
}

/**
 * Parses the raw LLM text response into an array of outfit suggestions.
 * Strips markdown code fences if the model includes them despite the prompt.
 */
export function parseOutfitSuggestions(raw: string): ParsedOutfitSuggestion[] {
  const cleaned = stripMarkdownFences(raw.trim())

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`LLM response is not valid JSON:\n${cleaned.slice(0, 300)}`)
  }

  const result = OutfitSuggestionsSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `LLM response does not match expected schema: ${result.error.message}`,
    )
  }

  return result.data.map((s) => ({
    weekday: s.weekday,
    clothingPieceIds: s.clothing_piece_ids,
  }))
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
}
