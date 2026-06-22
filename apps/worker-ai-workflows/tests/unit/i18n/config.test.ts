import { describe, it, expect } from "vitest"
import {
  DEFAULT_LOCALE,
  isLocale,
  resolveLanguageCode,
  resolveLocale,
} from "../../../src/lib/i18n/config"

describe("i18n config", () => {
  describe("resolveLocale()", () => {
    it("returns pt-BR by default", () => {
      expect(resolveLocale(null)).toBe(DEFAULT_LOCALE)
      expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
      expect(resolveLocale("")).toBe(DEFAULT_LOCALE)
    })

    it("accepts supported locale codes", () => {
      expect(resolveLocale("pt-BR")).toBe("pt-BR")
      expect(resolveLocale("es-PE")).toBe("es-PE")
      expect(resolveLocale("en-US")).toBe("en-US")
    })

    it("normalizes legacy lowercase aliases", () => {
      expect(resolveLocale("pt-br")).toBe("pt-BR")
      expect(resolveLocale("es-pe")).toBe("es-PE")
      expect(resolveLocale("en-us")).toBe("en-US")
    })

    it("falls back to pt-BR for unknown values", () => {
      expect(resolveLocale("fr-FR")).toBe("pt-BR")
    })
  })

  describe("resolveLanguageCode()", () => {
    it("maps domain name to locale code", () => {
      expect(resolveLanguageCode("Português (BR)")).toBe("pt-BR")
      expect(resolveLanguageCode("Español (PE)")).toBe("es-PE")
      expect(resolveLanguageCode("English (US)")).toBe("en-US")
    })

    it("returns null for unknown domain names", () => {
      expect(resolveLanguageCode("Français (FR)")).toBeNull()
    })
  })

  describe("isLocale()", () => {
    it("recognizes supported locales", () => {
      expect(isLocale("pt-BR")).toBe(true)
      expect(isLocale("es-PE")).toBe(true)
      expect(isLocale("en-US")).toBe(true)
      expect(isLocale("pt-br")).toBe(false)
    })
  })
})
