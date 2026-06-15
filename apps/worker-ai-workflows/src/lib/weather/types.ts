export interface DailyWeather {
  /** ISO date string — "YYYY-MM-DD". */
  date: string
  maxTempC: number
  minTempC: number
  /** 0–100 percentage. */
  precipitationProbability: number
  /** WMO weather interpretation code. */
  weatherCode: number
}

export interface WeeklyForecast {
  location: string
  days: DailyWeather[]
}

export interface WeatherProvider {
  /**
   * Returns a 7-day forecast starting from the given date.
   * @param location  Free-form location string, e.g. "Rio de Janeiro, Rio de Janeiro, Brasil"
   * @param startDate ISO date string for the first day of the forecast week ("YYYY-MM-DD").
   */
  getForecast(location: string, startDate: string): Promise<WeeklyForecast>
}
