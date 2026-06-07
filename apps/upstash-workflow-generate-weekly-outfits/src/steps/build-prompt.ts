import { getReadDb } from "../lib/db/client"
import { SqlPreferencesRepository } from "../lib/db/preferences.repository"
import { SqlWardrobeRepository } from "../lib/db/wardrobe.repository"
import { getWeatherProvider } from "../lib/weather"
import { buildPrompt, formatDayWeatherSummary } from "../lib/prompt/builder"
import { createLogger } from "../lib/logger"
import type { DailyWeather } from "../lib/weather/types"

const ENGLISH_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

export interface BuildPromptResult {
  userId: string
  weeklyOutfitPreferencesId: string
  weekStartDate: string
  prompt: string
  dayWeatherSummaries: Record<string, string>
  /** Maps clothing item ID → public image URL for every wardrobe piece that has an image. */
  wardrobeImageMap: Record<string, string>
}

function buildDayWeatherSummaries(days: DailyWeather[]): Record<string, string> {
  const summaries: Record<string, string> = {}
  for (const day of days) {
    const date = new Date(day.date + "T12:00:00Z")
    const weekdayEn = ENGLISH_WEEKDAYS[date.getUTCDay()]
    if (weekdayEn) summaries[weekdayEn] = formatDayWeatherSummary(day)
  }
  return summaries
}

/**
 * Step 1 — Gathers all data needed to build the LLM prompt:
 *   - user preferences (location, routine description)
 *   - wardrobe items with tags
 *   - 7-day weather forecast for the user's location
 *
 * Throws if the user has no preferences or no wardrobe items.
 * Gracefully continues without weather data if the forecast API is unavailable.
 */
export async function buildPromptStep(
  userId: string,
  weekStartDate: string,
): Promise<BuildPromptResult> {
  const log = createLogger("build-prompt", userId)
  log.info("Step started", { weekStartDate })

  const readDb = getReadDb()
  const prefsRepo = new SqlPreferencesRepository(readDb)
  const wardrobeRepo = new SqlWardrobeRepository(readDb)

  log.debug("Fetching preferences and wardrobe in parallel")
  const [preferences, wardrobeItems] = await Promise.all([
    prefsRepo.findByUserId(userId),
    wardrobeRepo.findByUserId(userId),
  ])

  if (!preferences) {
    log.error("No preferences found — aborting")
    throw new Error(
      `No weekly outfit preferences found for user "${userId}" — aborting workflow`,
    )
  }
  log.info("Preferences loaded", {
    preferencesId: preferences.id,
    location: preferences.location,
  })

  if (wardrobeItems.length === 0) {
    log.error("Empty wardrobe — aborting")
    throw new Error(`User "${userId}" has no wardrobe items — aborting workflow`)
  }
  log.info("Wardrobe loaded", { itemCount: wardrobeItems.length })

  let forecast = null
  try {
    log.info("Fetching weather forecast", { location: preferences.location, weekStartDate })
    const weatherProvider = getWeatherProvider()
    forecast = await weatherProvider.getForecast(preferences.location, weekStartDate)
    log.info("Weather forecast fetched", { daysCount: forecast.days.length })
  } catch (err) {
    log.warn("Weather forecast unavailable — continuing without weather data", {
      location: preferences.location,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const prompt = buildPrompt({
    wardrobe: wardrobeItems,
    preferences: preferences.routineDescription,
    forecast: forecast ?? { location: preferences.location, days: [] },
  })

  const dayWeatherSummaries = buildDayWeatherSummaries(forecast?.days ?? [])

  const wardrobeImageMap: Record<string, string> = {}
  for (const item of wardrobeItems) {
    if (item.imageUrl) wardrobeImageMap[item.id] = item.imageUrl
  }

  log.info("Prompt built", {
    promptLength: prompt.length,
    weatherDays: Object.keys(dayWeatherSummaries).length,
    wardrobeItemsWithImages: Object.keys(wardrobeImageMap).length,
  })

  return {
    userId,
    weeklyOutfitPreferencesId: preferences.id,
    weekStartDate,
    prompt,
    dayWeatherSummaries,
    wardrobeImageMap,
  }
}
