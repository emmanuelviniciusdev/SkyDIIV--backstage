import { describe, it, expect } from "vitest"
import {
  buildDayWeatherInfo,
  formatDayWeatherSummary,
  formatWeatherForecast,
  weatherCodeDescription,
} from "../../../src/lib/i18n/weather/formatters"
import type { DailyWeather, WeeklyForecast } from "../../../src/lib/weather/types"

const DAY: DailyWeather = {
  date: "2026-06-07",
  maxTempC: 28.4,
  minTempC: 22.1,
  precipitationProbability: 10,
  weatherCode: 0,
}

const FORECAST: WeeklyForecast = {
  location: "Rio de Janeiro, Rio de Janeiro, Brasil",
  days: [DAY],
}

describe("i18n weather formatters", () => {
  describe("weatherCodeDescription()", () => {
    it("returns pt-BR labels by default locale", () => {
      expect(weatherCodeDescription(0, "pt-BR")).toBe("Céu limpo")
      expect(weatherCodeDescription(61, "pt-BR")).toBe("Chuva")
    })

    it("returns es-PE labels", () => {
      expect(weatherCodeDescription(0, "es-PE")).toBe("Cielo despejado")
      expect(weatherCodeDescription(61, "es-PE")).toBe("Lluvia")
    })

    it("returns en-US labels", () => {
      expect(weatherCodeDescription(0, "en-US")).toBe("Clear sky")
      expect(weatherCodeDescription(61, "en-US")).toBe("Rain")
    })
  })

  describe("formatDayWeatherSummary()", () => {
    it("formats pt-BR summary", () => {
      expect(formatDayWeatherSummary(DAY, "pt-BR")).toBe(
        "Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%",
      )
    })

    it("formats en-US summary", () => {
      expect(formatDayWeatherSummary(DAY, "en-US")).toBe(
        "Clear sky, high 28°C / low 22°C, rain: 10%",
      )
    })
  })

  describe("buildDayWeatherInfo()", () => {
    it("returns structured weather fields for database storage", () => {
      expect(buildDayWeatherInfo(DAY, "pt-BR")).toEqual({
        weatherSummary: "Céu limpo, máx. 28°C / mín. 22°C, chuva: 10%",
        minTemperature: 22.1,
        maxTemperature: 28.4,
        unityTemperature: "°C",
        descriptionTemperature: "Céu limpo",
      })
    })

    it("localizes descriptionTemperature by locale", () => {
      expect(buildDayWeatherInfo(DAY, "en-US").descriptionTemperature).toBe("Clear sky")
    })
  })

  describe("formatWeatherForecast()", () => {
    it("uses locale-specific location header", () => {
      expect(formatWeatherForecast(FORECAST, "pt-BR")).toContain("Localização:")
      expect(formatWeatherForecast(FORECAST, "es-PE")).toContain("Ubicación:")
      expect(formatWeatherForecast(FORECAST, "en-US")).toContain("Location:")
    })

    it("uses locale-specific weekday names", () => {
      expect(formatWeatherForecast(FORECAST, "pt-BR")).toContain("Domingo")
      expect(formatWeatherForecast(FORECAST, "en-US")).toMatch(/Sunday/i)
    })
  })
})
