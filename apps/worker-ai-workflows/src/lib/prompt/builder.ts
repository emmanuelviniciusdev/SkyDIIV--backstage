import { z } from "zod"
import { WEEKLY_OUTFIT_PROMPT_TEMPLATE } from "./template"
import type { WardrobeItem } from "../db/wardrobe.repository"
import type { DailyWeather, WeeklyForecast } from "../weather/types"

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export interface BuildPromptInput {
  wardrobe: WardrobeItem[]
  preferences: string
  forecast: WeeklyForecast
}

/**
 * Builds the full weekly-outfit prompt by interpolating wardrobe items,
 * user preferences, and the 7-day weather forecast into the template.
 */
export function buildPrompt(input: BuildPromptInput): string {
  const wardrobeBlock =
    input.wardrobe.length > 0
      ? input.wardrobe
          .map((item) => {
            const title = item.title.trim() || "no title"
            const tags = item.tags.length > 0 ? item.tags.join(", ") : "no tags"
            return `ID:${item.id} | TÍTULO:${title} | TAGS:${tags}`
          })
          .join("\n")
      : "No wardrobe items available."

  const weatherBlock = formatWeatherForecast(input.forecast)

  return WEEKLY_OUTFIT_PROMPT_TEMPLATE.replace("{wardrobe}", wardrobeBlock)
    .replace("{preferences}", input.preferences.trim() || "No specific preferences provided.")
    .replace("{weather_forecast}", weatherBlock)
}

/**
 * Maps WMO weather interpretation codes to friendly Portuguese (Brazil) labels.
 * Reference: https://open-meteo.com/en/docs#weathervariables (weather_code)
 */
export function weatherCodeDescription(code: number): string {
  if (code === 0) return "Céu limpo"
  if (code === 1) return "Predominantemente limpo"
  if (code === 2) return "Parcialmente nublado"
  if (code === 3) return "Nublado"
  if (code === 45 || code === 48) return "Neblina"
  if (code >= 51 && code <= 55) return "Garoa"
  if (code === 56 || code === 57) return "Garoa congelante"
  if (code >= 61 && code <= 65) return "Chuva"
  if (code === 66 || code === 67) return "Chuva congelante"
  if (code >= 71 && code <= 75) return "Neve"
  if (code === 77) return "Granizo"
  if (code >= 80 && code <= 82) return "Pancadas de chuva"
  if (code === 85 || code === 86) return "Pancadas de neve"
  if (code === 95) return "Trovoada"
  if (code === 96 || code === 99) return "Trovoada com granizo"
  return "Tempo variável"
}

/**
 * Returns a compact, human-readable pt-BR weather summary for a single day.
 * Stored in the `weather_summary` column of `weekly_outfits`.
 *
 * Example: "Parcialmente nublado, máx. 27°C / mín. 21°C, chuva: 30%"
 */
export function formatDayWeatherSummary(day: DailyWeather): string {
  const desc = weatherCodeDescription(day.weatherCode)
  const max = Math.round(day.maxTempC)
  const min = Math.round(day.minTempC)
  return `${desc}, máx. ${max}°C / mín. ${min}°C, chuva: ${day.precipitationProbability}%`
}

/**
 * Formats a WeeklyForecast into a human-readable pt-BR block for the LLM prompt.
 *
 * Exemplo:
 *   Localização: Rio de Janeiro, Rio de Janeiro, Brasil
 *   Previsão para a semana:
 *   - Domingo, 8 de jun.: Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%
 *   - Segunda-feira, 9 de jun.: Parcialmente nublado, máx. 27°C / mín. 21°C, chuva: 30%
 *   ...
 */
export function formatWeatherForecast(forecast: WeeklyForecast): string {
  const lines = [
    `Localização: ${forecast.location}`,
    "Previsão para a semana:",
    ...forecast.days.map((day) => {
      const date = new Date(day.date + "T12:00:00Z") // noon UTC to avoid DST issues
      const weekday = date.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" })
      const dayMonth = date.toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
      const capitalised = weekday.charAt(0).toUpperCase() + weekday.slice(1)
      return `- ${capitalised}, ${dayMonth}: ${formatDayWeatherSummary(day)}`
    }),
  ]
  return lines.join("\n")
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
