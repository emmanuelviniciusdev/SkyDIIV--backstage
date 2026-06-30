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

  const fakePanorama = `## equilíbrio do guarda-roupa\nO seu guarda-roupa tem muitas camisas brancas e poucas peças de sobreposição, aparentando concentrar-se em looks formais.\n\n## seu estilo\nO conteúdo das peças indica um viés clássico com toques casuais.\n\n## o que vale buscar\nSugiro investir em 1) um blazer casual para multiplicar combinações formais-casuais e 2) algumas camisetas básicas neutras para equilibrar variações.`
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
    expect(result.prompt).toContain("Nome: Ana")
    expect(result.prompt).toContain("PREFERÊNCIAS DO USUÁRIO:")
    expect(result.prompt).toContain("DADOS DO GUARDA-ROUPA:")
    expect(result.prompt).toContain("RESUMO POR TIPO:")
    expect(result.prompt).toContain("Top: 1 peça → Shirt (1)")
    expect(result.prompt).toContain("Bottom: 1 peça → Jeans (1)")
    expect(result.prompt).toContain("Total: 2 peças")
    // Verify the item formatting
    expect(result.prompt).toContain("ID: item-1 Título: Camisa branca; Tipo: Top; Subtipo: Shirt; Tags: formal, white")
    expect(result.prompt).toContain("ID: item-2 Título: Calça jeans; Tipo: Bottom; Subtipo: Jeans; Tags: casual, denim")
  })

  it("calls the LLM and returns an interaction id and response", async () => {
    const promptData = await buildPromptStep(mocks.USER_ID)
    const exec = await executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })

    expect(exec.llmInteractionId).toBeTruthy()
    expect(exec.response).toBe(mocks.fakePanorama)
    expect(exec.response).toContain("## equilíbrio do guarda-roupa")
  })

  it("persists the panorama to the DB (no throw) and invokes write DB", async () => {
    const promptData = await buildPromptStep(mocks.USER_ID)
    const exec = await executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })

    // Clear write mock call history then save
    mocks.writeDb.mockClear()
    await expect(
      savePanoramaStep({ userId: promptData.userId, llmInteractionId: exec.llmInteractionId, content: exec.response }),
    ).resolves.not.toThrow()

    expect(mocks.writeDb).toHaveBeenCalled()
    // One of the calls should be an INSERT into wardrobe_panorama — assert the mock was invoked at least once
    const calls = mocks.writeDb.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })
})
