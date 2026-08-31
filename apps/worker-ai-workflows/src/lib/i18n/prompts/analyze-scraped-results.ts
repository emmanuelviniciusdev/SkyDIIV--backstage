import type { Locale } from "../config"
import type { UnprocessedScrapeResult } from "../../db/scraped-products-swap.repository"

export interface BuildAnalyzeScrapedResultsPromptInput {
  locale: Locale
  panoramaContent: string
  routineDescription: string | null
  results: UnprocessedScrapeResult[]
}

const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  "pt-BR": "português brasileiro",
  "es-PE": "espanhol peruano",
  "en-US": "inglês americano",
}

export function buildAnalyzeScrapedResultsPrompt(
  input: BuildAnalyzeScrapedResultsPromptInput,
): string {
  const outputLanguage = LOCALE_LANGUAGE_NAMES[input.locale]
  const routine = input.routineDescription?.trim() || "não informada"

  const resultsBlock = input.results
    .map((row) => {
      return JSON.stringify({
        searchTermScrapedProductId: row.searchTermId,
        resultId: row.resultId,
        marketplace: row.marketplace,
        jsonSearch: row.jsonSearch,
        jsonResult: row.jsonResult,
      })
    })
    .join("\n")

  return `
Você é um consultor de moda pessoal do SkyDIIV. Escolha, para cada termo de busca, o anúncio mais relevante para o panorama do guarda-roupa.

Responda sempre em ${outputLanguage} apenas no raciocínio interno. A saída visível DEVE ser somente JSON.

Retorne APENAS um JSON (array). Sem markdown, sem comentários. Cada objeto:
- "searchTermScrapedProductId" (string): id do termo de busca
- "resultId" (string): id do anúncio escolhido para aquele termo

No máximo um anúncio por termo. Se nenhum anúncio servir para um termo, omita esse termo. Use somente ids fornecidos abaixo.

ROTINA / ESTILO:
${routine}

---

PANORAMA DO GUARDA-ROUPA:
${input.panoramaContent.trim()}

---

ANÚNCIOS DISPONÍVEIS:
${resultsBlock}
`.trim()
}
