import type { Locale } from "../../../../../lib/i18n/config"

/** Fixed subject — always English, regardless of user locale. */
export const WELCOME_EMAIL_SUBJECT = "you're in — SkyDIIV"

export interface WelcomeEmailCopy {
  greeting: string
  welcome: string
  bodyLine1: string
  bodyLine2: string
  bodyLine3: string
  cta: string
  signoff: string
}

function greeting(prefix: string, firstName?: string): string {
  const name = firstName?.trim()
  return name ? `${prefix}, ${name}.` : `${prefix}.`
}

export function getWelcomeEmailCopy(locale: Locale, firstName?: string): WelcomeEmailCopy {
  switch (locale) {
    case "en-US":
      return {
        greeting: greeting("hey", firstName),
        welcome: "welcome to skydiiv — glad you made it here.",
        bodyLine1: "start by adding your pieces. the more your wardrobe grows,",
        bodyLine2: "the better the app gets at knowing your style.",
        bodyLine3: "there's no rush — just build it at your own pace.",
        cta: "start building your wardrobe",
        signoff: "— skydiiv",
      }
    case "es-PE":
      return {
        greeting: greeting("hola", firstName),
        welcome: "bienvenido(a) a skydiiv — qué bueno que llegaste.",
        bodyLine1: "empieza agregando tus prendas. mientras más crece tu guardarropa,",
        bodyLine2: "mejor la app entiende tu estilo.",
        bodyLine3: "sin prisa — constrúyelo a tu ritmo.",
        cta: "empezar tu guardarropa",
        signoff: "— skydiiv",
      }
    case "pt-BR":
    default:
      return {
        greeting: greeting("oi", firstName),
        welcome: "bem-vindo(a) ao skydiiv — que bom que você chegou.",
        bodyLine1: "comece adicionando suas peças. quanto mais seu guarda-roupa cresce,",
        bodyLine2: "melhor o app entende o seu estilo.",
        bodyLine3: "sem pressa — construa no seu ritmo.",
        cta: "começar seu guarda-roupa",
        signoff: "— skydiiv",
      }
  }
}
