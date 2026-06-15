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
    { id: "item-1", title: "Camisa branca", image_url: "https://r2.example.com/items/item-1.jpg", tags: ["formal", "white"] },
    { id: "item-2", title: "Calça jeans", image_url: null, tags: ["casual", "denim"] },
  ]

  let readCallCount = 0
  const readDb = vi.fn().mockImplementation(() => {
    readCallCount++
    // Interleaved calls: first call -> preferences, second call -> wardrobe
    if (readCallCount % 2 === 1) return Promise.resolve([fakePreferencesRow])
    return Promise.resolve(fakeWardrobeRows)
  })

  const writeDb = vi.fn().mockResolvedValue([])

  const fakePanorama = `## equilíbrio do guarda-roupa\nO seu guarda-roupa tem muitas camisas brancas e poucas peças de sobreposição, aparentando concentrar-se em looks formais.\n\n## seu estilo\nO conteúdo das peças indica um viés clássico com toques casuais.\n\n## o que vale buscar\nSugiro investir em 1) um blazer casual para multiplicar combinações formais-casuais e 2) algumas camisetas básicas neutras para equilibrar variações.`
  const llmGenerate = vi.fn().mockResolvedValue(fakePanorama)

  return {
    USER_ID,
    PREFERENCES_ID,
    fakePreferencesRow,
    fakeWardrobeRows,
    readDb,
    writeDb,
    fakePanorama,
    llmGenerate,
    resetReadCallCount: () => {
      readCallCount = 0
    },
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
  it("builds a prompt containing preferences and wardrobe data", async () => {
    mocks.resetReadCallCount()
    const result = await buildPromptStep(mocks.USER_ID)

    expect(result.userId).toBe(mocks.USER_ID)
    expect(typeof result.prompt).toBe("string")
    expect(result.prompt).toContain("PREFERÊNCIAS DO USUÁRIO:")
    expect(result.prompt).toContain("DADOS DO GUARDA-ROUPA:")
    expect(result.prompt).toContain("Total de peças: 2")
    // Verify the item formatting
    expect(result.prompt).toContain("ID: item-1 Título: Camisa branca; Tags: formal, white")
    expect(result.prompt).toContain("ID: item-2 Título: Calça jeans; Tags: casual, denim")
  })

  it("calls the LLM and returns an interaction id and response", async () => {
    mocks.resetReadCallCount()
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
