const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"

export interface GeoLocation {
  latitude: number
  longitude: number
  name: string
  country: string
}

interface GeocodingResponse {
  results?: Array<{
    latitude: number
    longitude: number
    name: string
    country: string
  }>
}

/**
 * Geocodes a free-form location string to coordinates using the Open-Meteo
 * Geocoding API. Returns the best (first) match.
 */
export async function geocode(location: string): Promise<GeoLocation> {
  // Use the first token of the location string as the city name for the query
  // (e.g. "Rio de Janeiro, Rio de Janeiro, Brasil" → "Rio de Janeiro")
  const cityQuery = location.split(",")[0].trim()

  const url = new URL(GEOCODING_URL)
  url.searchParams.set("name", cityQuery)
  url.searchParams.set("count", "1")
  url.searchParams.set("language", "en")
  url.searchParams.set("format", "json")

  const res = await fetch(url.toString())

  if (!res.ok) {
    throw new Error(`Geocoding request failed: ${res.status} ${res.statusText}`)
  }

  const data: GeocodingResponse = await res.json()

  if (!data.results || data.results.length === 0) {
    throw new Error(`No geocoding results found for location: "${location}"`)
  }

  const { latitude, longitude, name, country } = data.results[0]
  return { latitude, longitude, name, country }
}
