import type { Locale } from "../../../../../lib/i18n/config"

/** Fixed subject — always English, regardless of user locale. */
export const WELCOME_EMAIL_SUBJECT = "you're in — SkyDIIV"

export interface WelcomeEmailCopy {
  greeting: string
  welcome: string
  bodyParagraphs: string[]
  closingLine: string
  cta: string
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
        welcome: "welcome to SkyDIIV.",
        bodyParagraphs: [
          "having too many pieces and nothing to wear is a paradox we solve.",
          "SkyDIIVRS around the world already get the logic: less chaos, more intelligence. our AI decodes what you have and transforms your routine, making getting dressed much clearer and more productive.",
          "you add your clothing pieces and the platform gives you vision and a complete panorama of your wardrobe.",
          "rediscover what you forgot, know exactly what's missing, and start consuming with more intelligence. the end of blind shopping.",
        ],
        closingLine: "absolute clarity about your wardrobe.",
        cta: "start now",
      }
    case "es-PE":
      return {
        greeting: greeting("hola", firstName),
        welcome: "bienvenidx a SkyDIIV.",
        bodyParagraphs: [
          "tener piezas de sobra y nada que ponerte es una paradoja que resolvemos.",
          "SkyDIIVRS alrededor del mundo ya entendieron la lógica: menos caos, más inteligencia. nuestra IA decodifica lo que tienes y transforma tu rutina, haciendo el proceso de vestirte mucho más claro y productivo.",
          "agregas tus piezas de ropa y la plataforma te da visión y un panorama completo de tu guardarropa.",
          "redescubre lo que olvidaste, sabe exactamente lo que falta y empieza a consumir con más inteligencia. el fin de las compras a ciegas.",
        ],
        closingLine: "claridad absoluta sobre tu guardarropa.",
        cta: "empezar ahora",
      }
    case "pt-BR":
    default:
      return {
        greeting: greeting("oi", firstName),
        welcome: "bem-vindx ao SkyDIIV.",
        bodyParagraphs: [
          "ter peças de sobra e nada para vestir é um paradoxo que a gente resolve.",
          "SkyDIIVRS ao redor do mundo já entenderam a lógica: menos caos, mais inteligência. nossa IA decodifica o que você tem e transforma a sua rotina, tornando o processo de se vestir muito mais claro e produtivo.",
          "você adiciona as suas peças de roupas e a plataforma te dá visão e um panorama completo do seu acervo.",
          "redescubra o que você esqueceu, saiba exatamente o que falta e passe a consumir com mais inteligência. o fim das compras no escuro.",
        ],
        closingLine: "clareza absoluta sobre o seu guarda-roupa.",
        cta: "começar agora",
      }
  }
}
