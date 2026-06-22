import { getReadDb } from "../../../lib/db/client"
import { SqlPreferencesRepository } from "../../../lib/db/preferences.repository"
import { SqlWardrobeRepository } from "../../../lib/db/wardrobe.repository"
import { getWeatherProvider } from "../../../lib/weather"
import { buildPrompt, formatDayWeatherSummary } from "../../../lib/prompt/builder"
import { resolveUserLocale, type Locale } from "../../../lib/i18n"
import { createLogger } from "../../../lib/logger"
import type { DailyWeather } from "../../../lib/weather/types"

const ENGLISH_WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

export interface BuildPromptResult {
  userId: string
  weeklyOutfitPreferencesId: string
  weekStartDate: string
  locale: Locale
  prompt: string
  dayWeatherSummaries: Record<string, string>
  /** Maps clothing item ID → public image URL for every wardrobe piece that has an image. */
  wardrobeImageMap: Record<string, string>
  /**
   * Every clothing item ID that belongs to this user's wardrobe.
   * Used in step 3 to filter out any IDs the LLM hallucinated so they never
   * reach the DB and trigger a foreign-key constraint violation.
   */
  validClothingItemIds: string[]
}

function buildDayWeatherSummaries(days: DailyWeather[], locale: Locale): Record<string, string> {
  const summaries: Record<string, string> = {}
  for (const day of days) {
    const date = new Date(day.date + "T12:00:00Z")
    const weekdayEn = ENGLISH_WEEKDAYS[date.getUTCDay()]
    if (weekdayEn) summaries[weekdayEn] = formatDayWeatherSummary(day, locale)
  }
  return summaries
}

/**
 * Step 1 — Gathers all data needed to build the LLM prompt:
 *   - user locale (from app_preferences.language_id)
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

  log.debug("Fetching locale, preferences and wardrobe in parallel")
  const [locale, preferences, wardrobeItems] = await Promise.all([
    resolveUserLocale(userId),
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
    locale,
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
    locale,
    wardrobe: wardrobeItems,
    preferences: preferences.routineDescription,
    forecast: forecast ?? { location: preferences.location, days: [] },
  })

  const dayWeatherSummaries = buildDayWeatherSummaries(forecast?.days ?? [], locale)

  const wardrobeImageMap: Record<string, string> = {}
  for (const item of wardrobeItems) {
    if (item.imageUrl) wardrobeImageMap[item.id] = item.imageUrl
  }

  log.info("Prompt built", {
    promptLength: prompt.length,
    locale,
    weatherDays: Object.keys(dayWeatherSummaries).length,
    wardrobeItemsWithImages: Object.keys(wardrobeImageMap).length,
  })

  return {
    userId,
    weeklyOutfitPreferencesId: preferences.id,
    weekStartDate,
    locale,
    prompt,
    dayWeatherSummaries,
    wardrobeImageMap,
    validClothingItemIds: wardrobeItems.map((item) => item.id),
  }
}
