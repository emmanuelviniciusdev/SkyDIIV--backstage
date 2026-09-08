import type { Locale } from "../config"
import { MAX_SEARCH_TERMS } from "../../shopping/suggestions"

export interface BuildGenerateSearchTermsPromptInput {
  locale: Locale
  panoramaContent: string
  routineDescription: string | null
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
  eligibleMarketplaces: string[]
  feedbackSummary?: string | null
}

export const SEARCH_TERMS_VARIETY_INSTRUCTION =
  "Mantenha variedade entre os termos: tipos, cores e estilos diferentes, a partir do panorama e da rotina. O resumo de feedback é um viés, não um filtro. Muitos likes em um item (por exemplo camisa preta) NÃO devem gerar só termos daquele item."

const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  "pt-BR": "português brasileiro",
  "es-PE": "espanhol peruano",
  "en-US": "inglês americano",
}

export function buildGenerateSearchTermsPrompt(
  input: BuildGenerateSearchTermsPromptInput,
): string {
  const outputLanguage = LOCALE_LANGUAGE_NAMES[input.locale]
  const routine = input.routineDescription?.trim() || "não informada"
  const gender = input.gender?.trim() || "não informado"
  const topSize = input.topSize?.trim() || "não informado"
  const bottomSize = input.bottomSize?.trim() || "não informado"
  const footSize = input.footSize?.trim() || "não informado"
  const marketplaces =
    input.eligibleMarketplaces.length > 0
      ? input.eligibleMarketplaces.join(", ")
      : "nenhum"
  const summary = input.feedbackSummary?.trim() ?? ""
  const summaryBlock = summary
    ? `
---

HISTÓRICO DE FEEDBACK (resumo de likes/dislikes):
${summary}

Use este resumo para evitar padrões rejeitados e como viés (não filtro) rumo ao que a pessoa costuma gostar.
${SEARCH_TERMS_VARIETY_INSTRUCTION}
O panorama continua mandando: preencha lacunas; não substitua o panorama por um único gosto frequente.
`.trim()
    : ""

  return `
Você é um consultor de moda pessoal do SkyDIIV. A partir do panorama de guarda-roupa abaixo, gere termos de busca para marketplaces de roupas de segunda mão.

Responda sempre em ${outputLanguage}. Os termos de busca ("term") DEVEM ser escritos nesse idioma.

Retorne APENAS um JSON (array). Sem markdown, sem comentários. No máximo ${MAX_SEARCH_TERMS} objetos. Cada objeto deve ter:
- "term" (string): termo de busca avançado, específico e pronto para busca (ex.: "blazer casual bege oversized").
- "sizeCategory" (string): uma de "top" | "bottom" | "foot" | "none".

Não inclua gender, tamanhos, marketplace, URLs ou campos extras. Não apague nem mencione produtos já sugeridos.

Marketplaces elegíveis (apenas contexto; a aplicação atribui o marketplace): ${marketplaces}

---

PREFERÊNCIAS DE COMPRA:
Gênero: ${gender}
Tamanho parte de cima: ${topSize}
Tamanho parte de baixo: ${bottomSize}
Tamanho calçados: ${footSize}

ROTINA / ESTILO:
${routine}

${summaryBlock}

---

PANORAMA DO GUARDA-ROUPA:
${input.panoramaContent.trim()}
`.trim()
}
