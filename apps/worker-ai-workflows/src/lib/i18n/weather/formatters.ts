import { localeToBcp47, type Locale } from "../config"
import { getLocaleMessages } from "../locales"
import type { DailyWeather, WeeklyForecast } from "../../weather/types"

export function weatherCodeDescription(code: number, locale: Locale): string {
  return getLocaleMessages(locale).weather.weatherCodeDescription(code)
}

/**
 * Returns a compact, human-readable weather summary for a single day.
 * Stored in the `weather_summary` column of `weekly_outfits`.
 */
export function formatDayWeatherSummary(day: DailyWeather, locale: Locale): string {
  const messages = getLocaleMessages(locale).weather
  const desc = messages.weatherCodeDescription(day.weatherCode)
  const max = Math.round(day.maxTempC)
  const min = Math.round(day.minTempC)
  return `${desc}, ${messages.maxLabel} ${max}°C / ${messages.minLabel} ${min}°C, ${messages.rainLabel}: ${day.precipitationProbability}%`
}

/**
 * Formats a WeeklyForecast into a human-readable block for the LLM prompt.
 */
export function formatWeatherForecast(forecast: WeeklyForecast, locale: Locale): string {
  const messages = getLocaleMessages(locale).weather
  const bcp47 = localeToBcp47(locale)

  const lines = [
    `${messages.locationLabel}: ${forecast.location}`,
    `${messages.forecastHeader}:`,
    ...forecast.days.map((day) => {
      const date = new Date(day.date + "T12:00:00Z")
      const weekday = date.toLocaleDateString(bcp47, { weekday: "long", timeZone: "UTC" })
      const dayMonth = date.toLocaleDateString(bcp47, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
      const capitalised = weekday.charAt(0).toUpperCase() + weekday.slice(1)
      return `- ${capitalised}, ${dayMonth}: ${formatDayWeatherSummary(day, locale)}`
    }),
  ]
  return lines.join("\n")
}
