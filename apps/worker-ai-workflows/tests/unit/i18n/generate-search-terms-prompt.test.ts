import { describe, it, expect } from "vitest"
import {
  SEARCH_TERMS_VARIETY_INSTRUCTION,
  buildGenerateSearchTermsPrompt,
} from "../../../src/lib/i18n/prompts/generate-search-terms"

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

  it("includes panorama, routine, and purchase preferences", () => {
    const prompt = buildGenerateSearchTermsPrompt({ ...BASE, locale: "pt-BR" })
    expect(prompt).toContain("## o que vale buscar")
    expect(prompt).toContain("escritório")
    expect(prompt).toContain("Female")
    expect(prompt).not.toContain("HISTÓRICO DE FEEDBACK")
  })

  it("omits the feedback section when summary is empty", () => {
    const prompt = buildGenerateSearchTermsPrompt({
      ...BASE,
      locale: "pt-BR",
      feedbackSummary: "   ",
    })
    expect(prompt).not.toContain("HISTÓRICO DE FEEDBACK")
    expect(prompt).not.toContain(SEARCH_TERMS_VARIETY_INSTRUCTION)
  })

  it("includes the summary and variety instruction when set", () => {
    const prompt = buildGenerateSearchTermsPrompt({
      ...BASE,
      locale: "pt-BR",
      feedbackSummary: "costuma gostar de camisa preta",
    })
    expect(prompt).toContain("HISTÓRICO DE FEEDBACK")
    expect(prompt).toContain("costuma gostar de camisa preta")
    expect(prompt).toContain(SEARCH_TERMS_VARIETY_INSTRUCTION)
    expect(prompt).toContain("## o que vale buscar")
    expect(prompt).toContain("escritório")
  })
})
