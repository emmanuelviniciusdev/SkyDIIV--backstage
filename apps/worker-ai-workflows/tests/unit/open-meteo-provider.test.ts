import { describe, it, expect, vi, afterEach } from "vitest"
import { OpenMeteoWeatherProvider } from "../../src/lib/weather/open-meteo.provider"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/lib/weather/geocoding", () => ({
  geocode: vi.fn().mockResolvedValue({
    latitude: -22.9068,
    longitude: -43.1729,
    name: "Rio de Janeiro",
    country: "Brazil",
  }),
}))

const makeForecastResponse = (startDate = "2026-06-07") => ({
  daily: {
    time: Array.from({ length: 7 }, (_, i) => {
      const [y, m, d] = startDate.split("-").map(Number)
      const date = new Date(Date.UTC(y, m - 1, d + i))
      return date.toISOString().split("T")[0]
    }),
    temperature_2m_max: [28, 27, 25, 24, 26, 28, 29],
    temperature_2m_min: [22, 21, 20, 19, 21, 22, 23],
    precipitation_probability_max: [10, 30, 60, 80, 20, 10, 5],
    weather_code: [0, 2, 61, 63, 1, 0, 0],
  },
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenMeteoWeatherProvider", () => {
  it("returns a WeeklyForecast with 7 days", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => makeForecastResponse(),
    } as Response)

    const provider = new OpenMeteoWeatherProvider()
    const result = await provider.getForecast("Rio de Janeiro, Rio de Janeiro, Brasil", "2026-06-07")

    expect(result.location).toBe("Rio de Janeiro, Rio de Janeiro, Brasil")
    expect(result.days).toHaveLength(7)
  })

  it("maps each day's temperature and precipitation correctly", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => makeForecastResponse("2026-06-07"),
    } as Response)

    const provider = new OpenMeteoWeatherProvider()
    const result = await provider.getForecast("Rio de Janeiro, Rio de Janeiro, Brasil", "2026-06-07")

    expect(result.days[0]).toMatchObject({
      date: "2026-06-07",
      maxTempC: 28,
      minTempC: 22,
      precipitationProbability: 10,
      weatherCode: 0,
    })

    expect(result.days[2]).toMatchObject({
      date: "2026-06-09",
      maxTempC: 25,
      minTempC: 20,
      precipitationProbability: 60,
      weatherCode: 61,
    })
  })

  it("throws when the forecast API returns a non-OK status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response)

    const provider = new OpenMeteoWeatherProvider()
    await expect(
      provider.getForecast("Rio de Janeiro, RJ, Brasil", "2026-06-07"),
    ).rejects.toThrow("503")
  })

  it("passes the correct start_date and end_date query parameters", async () => {
    let capturedUrl = ""
    vi.spyOn(global, "fetch").mockImplementationOnce(async (url) => {
      capturedUrl = String(url)
      return { ok: true, json: async () => makeForecastResponse("2026-06-07") } as Response
    })

    const provider = new OpenMeteoWeatherProvider()
    await provider.getForecast("Rio de Janeiro, RJ, Brasil", "2026-06-07")

    expect(capturedUrl).toContain("start_date=2026-06-07")
    expect(capturedUrl).toContain("end_date=2026-06-13")
  })

  it("requests all required daily variables", async () => {
    let capturedUrl = ""
    vi.spyOn(global, "fetch").mockImplementationOnce(async (url) => {
      capturedUrl = String(url)
      return { ok: true, json: async () => makeForecastResponse() } as Response
    })

    const provider = new OpenMeteoWeatherProvider()
    await provider.getForecast("Rio de Janeiro, RJ, Brasil", "2026-06-07")

    expect(capturedUrl).toContain("temperature_2m_max")
    expect(capturedUrl).toContain("temperature_2m_min")
    expect(capturedUrl).toContain("precipitation_probability_max")
    expect(capturedUrl).toContain("weather_code")
  })
})
