import { describe, it, expect } from "vitest"
import { getWelcomeEmailCopy, WELCOME_EMAIL_SUBJECT } from "../../src/workflows/email--welcome/templates/resend/welcome/copy"

describe("welcome email copy", () => {
  it("uses a fixed English subject", () => {
    expect(WELCOME_EMAIL_SUBJECT).toBe("you're in — SkyDIIV")
  })

  it("renders en-US copy", () => {
    const copy = getWelcomeEmailCopy("en-US", "Jane")
    expect(copy.greeting).toBe("hey, Jane.")
    expect(copy.welcome).toBe("welcome to SkyDIIV.")
    expect(copy.bodyParagraphs).toHaveLength(4)
    expect(copy.bodyParagraphs[0]).toBe("having too many pieces and nothing to wear is a paradox we solve.")
    expect(copy.closingLine).toBe("absolute clarity about your wardrobe.")
    expect(copy.cta).toBe("start now")
  })

  it("renders pt-BR copy", () => {
    const copy = getWelcomeEmailCopy("pt-BR", "Ana")
    expect(copy.greeting).toBe("oi, Ana.")
    expect(copy.welcome).toBe("bem-vindx ao SkyDIIV.")
    expect(copy.bodyParagraphs[0]).toBe("ter peças de sobra e nada para vestir é um paradoxo que a gente resolve.")
    expect(copy.bodyParagraphs[1]).toContain("SkyDIIVRS ao redor do mundo")
    expect(copy.closingLine).toBe("clareza absoluta sobre o seu guarda-roupa.")
    expect(copy.cta).toBe("começar agora")
  })

  it("renders es-PE copy", () => {
    const copy = getWelcomeEmailCopy("es-PE", "María")
    expect(copy.greeting).toBe("hola, María.")
    expect(copy.welcome).toBe("bienvenidx a SkyDIIV.")
    expect(copy.cta).toBe("empezar ahora")
  })

  it("omits the name when firstName is missing", () => {
    expect(getWelcomeEmailCopy("en-US").greeting).toBe("hey.")
    expect(getWelcomeEmailCopy("pt-BR").greeting).toBe("oi.")
  })
})
