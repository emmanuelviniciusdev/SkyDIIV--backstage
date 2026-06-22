import { describe, it, expect } from "vitest"
import { buildWardrobePanoramaPrompt } from "../../../src/lib/i18n/prompts/wardrobe-panorama"
import type { UserPreferences } from "../../../src/lib/db/preferences.repository"
import type { WardrobeItem } from "../../../src/lib/db/wardrobe.repository"

const PREFERENCES: UserPreferences = {
  id: "prefs-1",
  userId: "user-1",
  location: "Lima, Perú",
  routineDescription: "Trabajo en oficina",
}

const WARDROBE: WardrobeItem[] = [
  { id: "item-1", title: "Camisa blanca", imageUrl: null, tags: ["formal"] },
]

describe("buildWardrobePanoramaPrompt()", () => {
  it("builds pt-BR prompt with Portuguese section headers", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "pt-BR",
      userName: "Ana",
      preferences: PREFERENCES,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("consultor de moda pessoal do SkyDIIV")
    expect(prompt).toContain("DADOS DO USUÁRIO:")
    expect(prompt).toContain("Nome: Ana")
    expect(prompt).toContain("## equilíbrio do guarda-roupa")
    expect(prompt).toContain("ID: item-1 Título: Camisa blanca; Tags: formal")
  })

  it("builds es-PE prompt with Spanish section headers", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "es-PE",
      userName: "Ana",
      preferences: PREFERENCES,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("consultor de moda personal de SkyDIIV")
    expect(prompt).toContain("DATOS DEL USUARIO:")
    expect(prompt).toContain("Nombre: Ana")
    expect(prompt).toContain("## equilibrio del guardarropa")
    expect(prompt).toContain("ID: item-1 Título: Camisa blanca; Etiquetas: formal")
  })

  it("builds en-US prompt with English section headers", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "en-US",
      userName: "Ana",
      preferences: PREFERENCES,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("SkyDIIV personal fashion consultant")
    expect(prompt).toContain("USER DATA:")
    expect(prompt).toContain("Name: Ana")
    expect(prompt).toContain("## wardrobe balance")
    expect(prompt).toContain("ID: item-1 Title: Camisa blanca; Tags: formal")
  })
})
