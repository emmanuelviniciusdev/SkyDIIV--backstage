import { describe, it, expect, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const findLanguageByUserId = vi.fn()
  return { findLanguageByUserId }
})

vi.mock("../../../src/lib/i18n/app-preferences.repository", () => ({
  SqlAppPreferencesRepository: class {
    findLanguageByUserId = mocks.findLanguageByUserId
  },
}))

vi.mock("../../../src/lib/db/client", () => ({
  getReadDb: () => ({}),
}))

import { resolveUserLocale } from "../../../src/lib/i18n/resolve-user-locale"

describe("resolveUserLocale()", () => {
  it("returns pt-BR when app preferences are missing", async () => {
    mocks.findLanguageByUserId.mockResolvedValueOnce(null)

    await expect(resolveUserLocale("user-1")).resolves.toBe("pt-BR")
  })

  it("resolves locale from domain name", async () => {
    mocks.findLanguageByUserId.mockResolvedValueOnce({ name: "Español (PE)" })

    await expect(resolveUserLocale("user-2")).resolves.toBe("es-PE")
  })

  it("maps English (US) domain name to en-US", async () => {
    mocks.findLanguageByUserId.mockResolvedValueOnce({ name: "English (US)" })

    await expect(resolveUserLocale("user-3")).resolves.toBe("en-US")
  })
})
