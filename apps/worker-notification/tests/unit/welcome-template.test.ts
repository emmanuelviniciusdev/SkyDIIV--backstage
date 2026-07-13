import { describe, it, expect } from "vitest"
import { renderWelcomeEmail } from "../../src/workflows/email--welcome/templates/resend/welcome/index"

describe("renderWelcomeEmail", () => {
  it("always uses the fixed English subject", () => {
    for (const locale of ["en-US", "pt-BR", "es-PE"] as const) {
      const { subject } = renderWelcomeEmail({ locale, firstName: "Jane", appUrl: "https://skydiiv.space" })
      expect(subject).toBe("you're in — SkyDIIV")
    }
  })

  it("renders en-US body copy and CTA to /home", () => {
    const { html, text } = renderWelcomeEmail({
      locale: "en-US",
      firstName: "Jane",
      appUrl: "https://skydiiv.space/",
    })
    expect(html).toContain("fonts.googleapis.com/css2?family=Inter")
    expect(html).toContain("#AC7C76")
    expect(html).toContain("letter-spacing:0.3em")
    expect(html).not.toContain("cid:")
    expect(html).toContain("hey, Jane.")
    expect(html).toContain("welcome to skydiiv — glad you made it here.")
    expect(html).toContain("start by adding your pieces. the more your wardrobe grows,")
    expect(html).toContain("the better the app gets at knowing your style.")
    expect(html).toContain("there&#39;s no rush — just build it at your own pace.")
    expect(text).toContain("there's no rush — just build it at your own pace.")
    expect(html).toContain("start building your wardrobe")
    expect(html).toContain('href="https://skydiiv.space/home"')
    expect(text).toContain("— skydiiv")
  })

  it("renders pt-BR body copy", () => {
    const { html } = renderWelcomeEmail({
      locale: "pt-BR",
      firstName: "Ana",
      appUrl: "https://skydiiv.space",
    })
    expect(html).toContain("oi, Ana.")
    expect(html).toContain("bem-vindo(a) ao skydiiv — que bom que você chegou.")
    expect(html).toContain("começar seu guarda-roupa")
  })

  it("escapes HTML in the first name", () => {
    const { html } = renderWelcomeEmail({
      locale: "en-US",
      firstName: '<script>alert("x")</script>',
      appUrl: "https://skydiiv.space",
    })
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;")
  })
})
