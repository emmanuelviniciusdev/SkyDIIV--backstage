export const LOCALES = ["pt-BR", "es-PE", "en-US"] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "pt-BR"

const DOMAIN_NAME_TO_CODE: Record<string, Locale> = {
  "Português (BR)": "pt-BR",
  "Español (PE)": "es-PE",
  "English (US)": "en-US",
}

const LEGACY_LOCALE_ALIASES: Record<string, Locale> = {
  "pt-br": "pt-BR",
  "es-pe": "es-PE",
  "en-us": "en-US",
}

export function isLocale(value: string): value is Locale {
  return LOCALES.includes(value as Locale)
}

export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE
  if (isLocale(value)) return value
  return LEGACY_LOCALE_ALIASES[value.toLowerCase()] ?? DEFAULT_LOCALE
}

/**
 * Maps a language domain name (from `domains.name` via `app_preferences.language_id`)
 * to a supported locale code.
 */
export function resolveLanguageCode(name: string): Locale | null {
  return DOMAIN_NAME_TO_CODE[name] ?? null
}

export function localeToBcp47(locale: Locale): string {
  return locale
}
