import { describe, it, expect } from "vitest"
import { buildWardrobePanoramaPrompt } from "../../../src/lib/i18n/prompts/wardrobe-panorama"
import type { UserPreferences } from "../../../src/lib/db/preferences.repository"
import type { WardrobeItem } from "../../../src/lib/db/wardrobe.repository"

const PREFERENCES: UserPreferences = {
  id: "prefs-1",
  userId: "user-1",
  location: "Lima, Perú",
  routineDescription: "Trabalho em escritório",
}

const WARDROBE: WardrobeItem[] = [
  { id: "item-1", title: "Camisa blanca", imageUrl: null, tags: ["formal"], pieceType: "Top", pieceSubtype: "Shirt" },
  { id: "item-2", title: "Jeans azul", imageUrl: null, tags: ["casual"], pieceType: "Bottom", pieceSubtype: "Jeans" },
  { id: "item-3", title: "Camiseta branca", imageUrl: null, tags: ["casual"], pieceType: "Top", pieceSubtype: "T-Shirt" },
]

describe("buildWardrobePanoramaPrompt()", () => {
  it("always builds prompt with pt-BR instructions regardless of locale", () => {
    for (const locale of ["pt-BR", "es-PE", "en-US"] as const) {
      const prompt = buildWardrobePanoramaPrompt({
        locale,
        userName: "Ana",
        preferences: PREFERENCES,
        wardrobe: WARDROBE,
      })

      expect(prompt).toContain("consultor de moda pessoal do SkyDIIV")
      expect(prompt).toContain("DADOS DO USUÁRIO:")
      expect(prompt).toContain("Nome: Ana")
      expect(prompt).toContain("## equilíbrio do guarda-roupa")
      expect(prompt).toContain("DADOS DO GUARDA-ROUPA:")
      expect(prompt).toContain("sizeCategory")
      expect(prompt).toContain("no máximo 5")
    }
  })

  it("includes output language instruction matching the input locale", () => {
    const ptBR = buildWardrobePanoramaPrompt({
      locale: "pt-BR",
      userName: "Ana",
      preferences: null,
      wardrobe: WARDROBE,
    })
    expect(ptBR).toContain("Responda sempre em português brasileiro")

    const esPE = buildWardrobePanoramaPrompt({
      locale: "es-PE",
      userName: "Ana",
      preferences: null,
      wardrobe: WARDROBE,
    })
    expect(esPE).toContain("Responda sempre em espanhol peruano")

    const enUS = buildWardrobePanoramaPrompt({
      locale: "en-US",
      userName: "Ana",
      preferences: null,
      wardrobe: WARDROBE,
    })
    expect(enUS).toContain("Responda sempre em inglês americano")
  })

  it("includes wardrobe summary grouped by type and subtype", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "pt-BR",
      userName: "Ana",
      preferences: PREFERENCES,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("RESUMO POR TIPO:")
    expect(prompt).toContain("Top: 2 peças → Shirt (1), T-Shirt (1)")
    expect(prompt).toContain("Bottom: 1 peça → Jeans (1)")
    expect(prompt).toContain("Total: 3 peças")
  })

  it("includes wardrobe items in pt-BR format with en-US type/subtype values", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "pt-BR",
      userName: "Ana",
      preferences: PREFERENCES,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("ID: item-1 Título: Camisa blanca; Tipo: Top; Subtipo: Shirt; Tags: formal")
    expect(prompt).toContain("ID: item-2 Título: Jeans azul; Tipo: Bottom; Subtipo: Jeans; Tags: casual")
  })

  it("uses pt-BR preferences section labels", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "es-PE",
      userName: "Carlos",
      preferences: PREFERENCES,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("PREFERÊNCIAS DO USUÁRIO:")
    expect(prompt).toContain("Localização: Lima, Perú")
    expect(prompt).toContain("Descrição da rotina/estilo: Trabalho em escritório")
  })

  it("uses pt-BR fallback when preferences are null", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "pt-BR",
      userName: "Ana",
      preferences: null,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("não definidas")
  })

  it("uses pt-BR fallback for unknown user name", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "en-US",
      userName: "   ",
      preferences: null,
      wardrobe: WARDROBE,
    })

    expect(prompt).toContain("não informado")
  })

  it("shows noPieces fallback in pt-BR when wardrobe is empty", () => {
    const prompt = buildWardrobePanoramaPrompt({
      locale: "pt-BR",
      userName: "Ana",
      preferences: null,
      wardrobe: [],
    })

    expect(prompt).toContain("Nenhuma peça cadastrada.")
  })

  it("item titles can be in user language — not translated by the prompt", () => {
    const wardrobe: WardrobeItem[] = [
      { id: "x1", title: "White shirt", imageUrl: null, tags: ["formal"], pieceType: "Top", pieceSubtype: "Shirt" },
    ]
    const prompt = buildWardrobePanoramaPrompt({
      locale: "en-US",
      userName: "John",
      preferences: null,
      wardrobe,
    })

    expect(prompt).toContain("Título: White shirt")
    expect(prompt).toContain("Tipo: Top")
    expect(prompt).toContain("Subtipo: Shirt")
  })
})
