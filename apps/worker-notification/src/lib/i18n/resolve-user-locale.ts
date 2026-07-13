import { getReadDb } from "../db/client"
import { SqlAppPreferencesRepository } from "./app-preferences.repository"
import { DEFAULT_LOCALE, resolveLanguageCode, resolveLocale, type Locale } from "./config"

/**
 * Resolves the user's preferred locale from `app_preferences.language_id`.
 * Falls back to `pt-BR` when preferences are missing or the domain is unknown.
 */
export async function resolveUserLocale(userId: string): Promise<Locale> {
  const repo = new SqlAppPreferencesRepository(getReadDb())
  const language = await repo.findLanguageByUserId(userId)

  if (!language) return DEFAULT_LOCALE

  const code = resolveLanguageCode(language.name)
  return resolveLocale(code ?? DEFAULT_LOCALE)
}
