import type { Locale } from "../config"
import type { FeedbackFactoryRecord } from "../../automatic-thrifting/feedback-factory"

export interface BuildSummarizeFeedbackPromptInput {
  locale: Locale
  priorSummary: string
  records: FeedbackFactoryRecord[]
}

const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  "pt-BR": "português brasileiro",
  "es-PE": "espanhol peruano",
  "en-US": "inglês americano",
}

export const SUMMARIZER_TENDENCY_INSTRUCTION =
  "Descreva gostos e rejeições como tendências (por exemplo: \"costuma gostar\", \"costuma rejeitar\")."

export const SUMMARIZER_NON_EXCLUSIVE_INSTRUCTION =
  "Não use redação exclusiva como \"só quer\", \"apenas\", \"sempre busque\" ou \"somente\". Frequência de likes não significa que a pessoa só queira aquele item, cor ou tipo."

export function buildSummarizeAutomaticThriftingFeedbackPrompt(
  input: BuildSummarizeFeedbackPromptInput,
): string {
  const outputLanguage = LOCALE_LANGUAGE_NAMES[input.locale]
  const prior = input.priorSummary.trim()
  const priorBlock = prior
    ? `RESUMO ATUAL (atualize/incremente; não descarte o que ainda vale):\n${prior}`
    : "RESUMO ATUAL: (vazio — este é o primeiro lote.)"

  return `
Você resume o histórico de like/dislike de sugestões de garimpo automático do SkyDIIV.

Responda sempre em ${outputLanguage}.
Retorne APENAS o texto do resumo. Sem markdown, sem JSON, sem comentários.

${SUMMARIZER_TENDENCY_INSTRUCTION}
${SUMMARIZER_NON_EXCLUSIVE_INSTRUCTION}
Não cite URLs, ids ou JSON bruto. Não invente peças que não aparecem nos registros.

Cada registro já foi filtrado (fábrica do marketplace): liked, reason, title, price, currency, size, searchTerm, gender, tamanhos.

${priorBlock}

---

NOVOS REGISTROS (JSON):
${JSON.stringify(input.records)}
`.trim()
}
