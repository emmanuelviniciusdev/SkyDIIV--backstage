import { OpenMeteoWeatherProvider } from "./open-meteo.provider"
import type { WeatherProvider } from "./types"

export type { WeatherProvider, WeeklyForecast, DailyWeather } from "./types"

type WeatherProviderFactory = () => WeatherProvider

const registry = new Map<string, WeatherProviderFactory>()

registry.set("open_meteo", () => new OpenMeteoWeatherProvider())

/**
 * Returns the registered weather provider.
 * Falls back to "open_meteo" when no name is supplied.
 */
export function getWeatherProvider(name?: string): WeatherProvider {
  const key = name ?? process.env.WEATHER_PROVIDER ?? "open_meteo"
  const factory = registry.get(key)
  if (!factory) throw new Error(`Weather provider "${key}" is not registered`)
  return factory()
}

/** Registers a custom weather provider — useful for testing. */
export function registerWeatherProvider(name: string, factory: WeatherProviderFactory): void {
  registry.set(name, factory)
}
