import { geocode } from "./geocoding"
import { createLogger } from "../logger"
import type { WeatherProvider, WeeklyForecast, DailyWeather } from "./types"

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

interface OpenMeteoForecastResponse {
  daily: {
    time: string[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
    weather_code: number[]
  }
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  async getForecast(location: string, startDate: string): Promise<WeeklyForecast> {
    const log = createLogger("open-meteo")

    log.info("Geocoding location", { location })
    const coords = await geocode(location)
    log.info("Location geocoded", { location, latitude: coords.latitude, longitude: coords.longitude })

    const endDate = getEndDate(startDate, 6)
    log.info("Fetching forecast", { startDate, endDate })

    const url = new URL(FORECAST_URL)
    url.searchParams.set("latitude", String(coords.latitude))
    url.searchParams.set("longitude", String(coords.longitude))
    url.searchParams.set(
      "daily",
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    )
    url.searchParams.set("timezone", "auto")
    url.searchParams.set("start_date", startDate)
    url.searchParams.set("end_date", endDate)

    const res = await fetch(url.toString())

    if (!res.ok) {
      throw new Error(`Weather forecast request failed: ${res.status} ${res.statusText}`)
    }

    const data: OpenMeteoForecastResponse = await res.json()
    const { daily } = data

    const days: DailyWeather[] = daily.time.map((date, i) => ({
      date,
      maxTempC: daily.temperature_2m_max[i] ?? 0,
      minTempC: daily.temperature_2m_min[i] ?? 0,
      precipitationProbability: daily.precipitation_probability_max[i] ?? 0,
      weatherCode: daily.weather_code[i] ?? 0,
    }))

    log.info("Forecast fetched", { daysCount: days.length })
    return { location, days }
  }
}

/**
 * Adds `daysToAdd` calendar days to a "YYYY-MM-DD" date string.
 * Uses UTC arithmetic to avoid DST surprises.
 */
function getEndDate(startDate: string, daysToAdd: number): string {
  const [year, month, day] = startDate.split("-").map(Number)
  const d = new Date(Date.UTC(year, month - 1, day + daysToAdd))
  return d.toISOString().split("T")[0]
}
