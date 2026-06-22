/**
 * Maps WMO weather interpretation codes to locale-specific labels.
 * Reference: https://open-meteo.com/en/docs#weathervariables (weather_code)
 */
export function createWeatherCodeDescription(
  fallback: string,
  overrides: Partial<Record<number, string>> = {},
): (code: number) => string {
  const defaults: Record<number, string> = {
    0: overrides[0] ?? fallback,
    1: overrides[1] ?? fallback,
    2: overrides[2] ?? fallback,
    3: overrides[3] ?? fallback,
    45: overrides[45] ?? fallback,
    48: overrides[48] ?? fallback,
    51: overrides[51] ?? fallback,
    52: overrides[52] ?? fallback,
    53: overrides[53] ?? fallback,
    54: overrides[54] ?? fallback,
    55: overrides[55] ?? fallback,
    56: overrides[56] ?? fallback,
    57: overrides[57] ?? fallback,
    61: overrides[61] ?? fallback,
    62: overrides[62] ?? fallback,
    63: overrides[63] ?? fallback,
    64: overrides[64] ?? fallback,
    65: overrides[65] ?? fallback,
    66: overrides[66] ?? fallback,
    67: overrides[67] ?? fallback,
    71: overrides[71] ?? fallback,
    72: overrides[72] ?? fallback,
    73: overrides[73] ?? fallback,
    74: overrides[74] ?? fallback,
    75: overrides[75] ?? fallback,
    77: overrides[77] ?? fallback,
    80: overrides[80] ?? fallback,
    81: overrides[81] ?? fallback,
    82: overrides[82] ?? fallback,
    85: overrides[85] ?? fallback,
    86: overrides[86] ?? fallback,
    95: overrides[95] ?? fallback,
    96: overrides[96] ?? fallback,
    99: overrides[99] ?? fallback,
  }

  return (code: number): string => {
    if (code in defaults) return defaults[code]
    if (code >= 51 && code <= 55) return defaults[51]
    if (code === 56 || code === 57) return defaults[56]
    if (code >= 61 && code <= 65) return defaults[61]
    if (code === 66 || code === 67) return defaults[66]
    if (code >= 71 && code <= 75) return defaults[71]
    if (code >= 80 && code <= 82) return defaults[80]
    if (code === 85 || code === 86) return defaults[85]
    if (code === 96 || code === 99) return defaults[96]
    if (code === 45 || code === 48) return defaults[45]
    return fallback
  }
}
