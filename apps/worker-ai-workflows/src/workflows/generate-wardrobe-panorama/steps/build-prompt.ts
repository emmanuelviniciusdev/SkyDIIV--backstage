import { getReadDb } from "../../../lib/db/client"
import { SqlWardrobeRepository } from "../../../lib/db/wardrobe.repository"
import { SqlPreferencesRepository } from "../../../lib/db/preferences.repository"
import { resolveUserDisplayName, SqlUsersRepository } from "../../../lib/db/users.repository"
import {
  SqlShoppingSuggestionsPreferencesRepository,
  type ShoppingSuggestionsPreferences,
} from "../../../lib/db/shopping-suggestions-preferences.repository"
import { buildWardrobePanoramaPrompt, resolveUserLocale, type Locale } from "../../../lib/i18n"
import { createLogger } from "../../../lib/logger"

export interface BuildPromptResult {
  userId: string
  locale: Locale
  prompt: string
  wardrobeItems: { id: string; title: string; tags: string[] }[]
  validClothingItemIds: string[]
  shoppingPreferences: ShoppingSuggestionsPreferences | null
}

export async function buildPromptStep(userId: string): Promise<BuildPromptResult> {
  const log = createLogger("build-prompt-panorama", userId)
  const db = getReadDb()
  const wardrobeRepo = new SqlWardrobeRepository(db)
  const preferencesRepo = new SqlPreferencesRepository(db)
  const usersRepo = new SqlUsersRepository(db)
  const shoppingPrefsRepo = new SqlShoppingSuggestionsPreferencesRepository(db)

  log.info("Loading user locale, user, preferences, shopping prefs and wardrobe")
  const [locale, user, preferences, wardrobe, shoppingPreferences] = await Promise.all([
    resolveUserLocale(userId),
    usersRepo.findByUserId(userId),
    preferencesRepo.findByUserId(userId),
    wardrobeRepo.findByUserId(userId),
    shoppingPrefsRepo.findByUserId(userId),
  ])

  const prompt = buildWardrobePanoramaPrompt({
    locale,
    userName: resolveUserDisplayName(user),
    preferences,
    wardrobe,
  })

  log.info("Built prompt", {
    totalPieces: wardrobe.length,
    promptLength: prompt.length,
    locale,
    hasShoppingPreferences: shoppingPreferences !== null,
  })

  return {
    userId,
    locale,
    prompt,
    wardrobeItems: wardrobe.map((i) => ({ id: i.id, title: i.title, tags: i.tags })),
    validClothingItemIds: wardrobe.map((i) => i.id),
    shoppingPreferences,
  }
}
