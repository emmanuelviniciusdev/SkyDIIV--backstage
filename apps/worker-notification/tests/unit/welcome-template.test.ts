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
    expect(html).toContain("color:#C2BCA8")
    expect(html).toContain('class="email-text"')
    expect(html).toContain("#AC7C76")
    expect(html).toContain("font-size:28px")
    expect(html).not.toContain("cid:")
    expect(html).toContain("hey, Jane.")
    expect(html).toContain("welcome to SkyDIIV.")
    expect(html).toContain("having too many pieces and nothing to wear is a paradox we solve.")
    expect(html).toContain("SkyDIIVRS around the world already get the logic:")
    expect(html).toContain("absolute clarity about your wardrobe.")
    expect(text).toContain("absolute clarity about your wardrobe.")
    expect(html).toContain("making getting dressed much clearer and more productive.")
    expect(html).toContain("a complete panorama of your wardrobe.")
    expect(html).toContain("start consuming with more intelligence.")
    expect(html).toContain("start now")
    expect(html).toContain('href="https://skydiiv.space/home"')
    expect(text).not.toContain("— skydiiv")
  })

  it("renders pt-BR body copy", () => {
    const { html } = renderWelcomeEmail({
      locale: "pt-BR",
      firstName: "Ana",
      appUrl: "https://skydiiv.space",
    })
    expect(html).toContain("oi, Ana.")
    expect(html).toContain("bem-vindx ao SkyDIIV.")
    expect(html).toContain("ter peças de sobra e nada para vestir é um paradoxo que a gente resolve.")
    expect(html).toContain("SkyDIIVRS ao redor do mundo já entenderam a lógica:")
    expect(html).toContain("clareza absoluta sobre o seu guarda-roupa.")
    expect(html).toContain("começar agora")
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
