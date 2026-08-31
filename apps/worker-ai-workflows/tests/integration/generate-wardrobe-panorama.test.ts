import { describe, it, expect, vi } from "vitest"

// Fixtures and mocks must be created with vi.hoisted() so factories run before
// module initialisation (required for mocking modules that call getReadDb()).
const mocks = vi.hoisted(() => {
  const USER_ID = "user-panorama-test"
  const PREFERENCES_ID = "prefs-panorama-test"

  const fakePreferencesRow = {
    id: PREFERENCES_ID,
    user_id: USER_ID,
    location: "São Paulo, São Paulo, Brasil",
    routine_description: "Trabalho em escritório, reuniões presenciais algumas vezes por semana.",
  }

  const fakeWardrobeRows = [
    { id: "item-1", title: "Camisa branca", image_url: "https://r2.example.com/items/item-1.jpg", tags: ["formal", "white"], piece_type: "Top", piece_subtype: "Shirt" },
    { id: "item-2", title: "Calça jeans", image_url: null, tags: ["casual", "denim"], piece_type: "Bottom", piece_subtype: "Jeans" },
  ]

  const fakeUserRow = {
    preferred_name: "Aninha",
    first_name: "Ana",
    last_name: "Costa",
  }

  const fakeLanguageRow = {
    name: "Português (BR)",
  }

  const readDb = vi.fn().mockImplementation((strings: TemplateStringsArray | string[]) => {
    const query = Array.isArray(strings) ? strings.join("") : String(strings)
    if (query.includes("app_preferences")) return Promise.resolve([fakeLanguageRow])
    if (query.includes("weekly_outfit_preferences")) return Promise.resolve([fakePreferencesRow])
    if (query.includes("clothing_items")) return Promise.resolve(fakeWardrobeRows)
    if (query.includes("users")) return Promise.resolve([fakeUserRow])
    return Promise.resolve([])
  })

  const writeDb = vi.fn().mockResolvedValue([])

  const fakePanorama = `## equilíbrio do guarda-roupa
O seu guarda-roupa tem muitas camisas brancas e poucas peças de sobreposição, aparentando concentrar-se em looks formais.

## seu estilo
O conteúdo das peças indica um viés clássico com toques casuais.

## o que vale buscar
Sugiro investir em um blazer casual e algumas camisetas básicas neutras.`
  const llmGenerate = vi.fn().mockResolvedValue(fakePanorama)

  return {
    USER_ID,
    PREFERENCES_ID,
    fakePreferencesRow,
    fakeWardrobeRows,
    fakeUserRow,
    readDb,
    writeDb,
    fakePanorama,
    llmGenerate,
  }
})

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.readDb,
  getWriteDb: () => mocks.writeDb,
  resetDbClients: vi.fn(),
}))

vi.mock("../../src/lib/llm/index", () => ({
  getLlmProvider: () => ({ name: "mock-llm", generate: mocks.llmGenerate }),
  registerLlmProvider: vi.fn(),
}))

// Import steps AFTER mocks are registered
import { buildPromptStep } from "../../src/workflows/generate-wardrobe-panorama/steps/build-prompt"
import { executePromptStep } from "../../src/workflows/generate-wardrobe-panorama/steps/execute-prompt"
import { savePanoramaStep } from "../../src/workflows/generate-wardrobe-panorama/steps/save-panorama"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generate-wardrobe-panorama workflow steps", () => {
  it("builds a prompt containing user name, preferences and wardrobe data", async () => {
    const result = await buildPromptStep(mocks.USER_ID)

    expect(result.userId).toBe(mocks.USER_ID)
    expect(result.locale).toBe("pt-BR")
    expect(typeof result.prompt).toBe("string")
    expect(result.prompt).toContain("DADOS DO USUÁRIO:")
    expect(result.prompt).toContain("Nome: Aninha")
    expect(result.prompt).toContain("PREFERÊNCIAS DO USUÁRIO:")
    expect(result.prompt).toContain("DADOS DO GUARDA-ROUPA:")
    expect(result.prompt).toContain("RESUMO POR TIPO:")
    expect(result.prompt).toContain("Top: 1 peça → Shirt (1)")
    expect(result.prompt).toContain("Bottom: 1 peça → Jeans (1)")
    expect(result.prompt).toContain("Total: 2 peças")
    expect(result.prompt).toContain("ID: item-1 Título: Camisa branca; Tipo: Top; Subtipo: Shirt; Tags: formal, white")
    expect(result.prompt).toContain("ID: item-2 Título: Calça jeans; Tipo: Bottom; Subtipo: Jeans; Tags: casual, denim")
    expect(result.prompt).toContain("## o que vale buscar")
    expect(result.prompt).not.toContain("sizeCategory")
    expect(result.prompt).not.toContain("```json")
    expect(result).not.toHaveProperty("shoppingPreferences")
  })

  it("calls the LLM and returns markdown content without requiring a JSON fence", async () => {
    const promptData = await buildPromptStep(mocks.USER_ID)
    const exec = await executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })

    expect(exec.llmInteractionId).toBeTruthy()
    expect(exec.content).toContain("## equilíbrio do guarda-roupa")
    expect(exec.content).toContain("## o que vale buscar")
    expect(exec.content).not.toContain("```json")
    expect(exec).not.toHaveProperty("suggestions")
  })

  it("persists only the markdown panorama (no JSON fence) and does not insert scrape outbox rows", async () => {
    const promptData = await buildPromptStep(mocks.USER_ID)
    const exec = await executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })

    mocks.writeDb.mockClear()
    await expect(
      savePanoramaStep({
        userId: promptData.userId,
        llmInteractionId: exec.llmInteractionId,
        content: exec.content,
      }),
    ).resolves.not.toThrow()

    expect(mocks.writeDb).toHaveBeenCalled()
    expect(exec.content).not.toContain("searchTerm")
    const sql = mocks.writeDb.mock.calls
      .flatMap((call) => {
        const first = call[0]
        if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
        return []
      })
      .join(" ")
    expect(sql).not.toMatch(/outbox_events/i)
    expect(sql).not.toMatch(/scrape-shopping-suggestions/i)