import { describe, it, expect, vi } from "vitest"
import { SqlAppPreferencesRepository } from "../../src/lib/i18n/app-preferences.repository"
import { resolveLanguageCode, resolveLocale } from "../../src/lib/i18n/config"
import { resolveUserLocale } from "../../src/lib/i18n/resolve-user-locale"

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: vi.fn(() => ({ __db: true })),
}))

describe("resolveUserLocale", () => {
  it("maps a language domain name to a locale", () => {
    expect(resolveLanguageCode("English (US)")).toBe("en-US")
    expect(resolveLanguageCode("Português (BR)")).toBe("pt-BR")
    expect(resolveLocale("en-US")).toBe("en-US")
  })

  it("falls back to pt-BR when preferences are missing", async () => {
    vi.spyOn(SqlAppPreferencesRepository.prototype, "findLanguageByUserId").mockResolvedValue(null)
    await expect(resolveUserLocale("user-1")).resolves.toBe("pt-BR")
  })

  it("resolves the locale from app_preferences", async () => {
    vi.spyOn(SqlAppPreferencesRepository.prototype, "findLanguageByUserId").mockResolvedValue({
      name: "English (US)",
    })
    await expect(resolveUserLocale("user-1")).resolves.toBe("en-US")
  })
})
