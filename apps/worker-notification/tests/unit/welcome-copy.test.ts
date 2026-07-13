import { describe, it, expect } from "vitest"
import { getWelcomeEmailCopy, WELCOME_EMAIL_SUBJECT } from "../../src/workflows/email--welcome/templates/resend/welcome/copy"

describe("welcome email copy", () => {
  it("uses a fixed English subject", () => {
    expect(WELCOME_EMAIL_SUBJECT).toBe("you're in — SkyDIIV")
  })

  it("renders en-US copy", () => {
    const copy = getWelcomeEmailCopy("en-US", "Jane")
    expect(copy.greeting).toBe("hey, Jane.")
    expect(copy.welcome).toBe("welcome to skydiiv — glad you made it here.")
    expect(copy.bodyLine1).toBe("start by adding your pieces. the more your wardrobe grows,")
    expect(copy.bodyLine2).toBe("the better the app gets at knowing your style.")
    expect(copy.bodyLine3).toBe("there's no rush — just build it at your own pace.")
    expect(copy.cta).toBe("start building your wardrobe")
  })

  it("renders pt-BR copy", () => {
    const copy = getWelcomeEmailCopy("pt-BR", "Ana")
    expect(copy.greeting).toBe("oi, Ana.")
    expect(copy.welcome).toBe("bem-vindo(a) ao skydiiv — que bom que você chegou.")
    expect(copy.cta).toBe("começar seu guarda-roupa")
  })

  it("renders es-PE copy", () => {
    const copy = getWelcomeEmailCopy("es-PE", "María")
    expect(copy.greeting).toBe("hola, María.")
    expect(copy.welcome).toBe("bienvenido(a) a skydiiv — qué bueno que llegaste.")
    expect(copy.cta).toBe("empezar tu guardarropa")
  })

  it("omits the name when firstName is missing", () => {
    expect(getWelcomeEmailCopy("en-US").greeting).toBe("hey.")
    expect(getWelcomeEmailCopy("pt-BR").greeting).toBe("oi.")
  })
})
