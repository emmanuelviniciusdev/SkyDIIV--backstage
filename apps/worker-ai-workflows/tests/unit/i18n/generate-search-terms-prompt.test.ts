import { describe, it, expect } from "vitest"
import { buildGenerateSearchTermsPrompt } from "../../../src/lib/i18n/prompts/generate-search-terms"

const BASE = {
  panoramaContent: "## o que vale buscar\nblazer",
  routineDescription: "escritório",
  gender: "Female",
  topSize: "M",
  bottomSize: "40",
  footSize: "38",
  eligibleMarketplaces: ["enjoei"],
}

describe("buildGenerateSearchTermsPrompt()", () => {
  it("asks for terms in the resolved locale", () => {
    const esPE = buildGenerateSearchTermsPrompt({ ...BASE, locale: "es-PE" })
    expect(esPE).toContain("Responda sempre em espanhol peruano")

    const ptBR = buildGenerateSearchTermsPrompt({ ...BASE, locale: "pt-BR" })
    expect(ptBR).toContain("Responda sempre em português brasileiro")
  })
})
