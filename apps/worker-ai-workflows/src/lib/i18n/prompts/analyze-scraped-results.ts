import type { Locale } from "../config"
import type { UnprocessedScrapeResult } from "../../db/scraped-products-swap.repository"

export interface BuildAnalyzeScrapedResultsPromptInput {
  locale: Locale
  panoramaContent: string
  routineDescription: string | null
  results: UnprocessedScrapeResult[]
}

/** Fields the analyze prompt needs: ids to return plus listing text to judge. */
export interface AnalyzePromptListing {
  searchTermScrapedProductId: string
  resultId: string
  title: string | null
  price: number | null
  currency: string | null
  size: string | null
}

const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  "pt-BR": "português brasileiro",
  "es-PE": "espanhol peruano",
  "en-US": "inglês americano",
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return null
}

export function toAnalyzePromptListing(row: UnprocessedScrapeResult): AnalyzePromptListing {
  const metadata = asRecord(row.jsonResult.metadata)
  return {
    searchTermScrapedProductId: row.searchTermId,
    resultId: row.resultId,
    title: asString(row.jsonResult.title),
    price: asNumber(row.jsonResult.price),
    currency: asString(row.jsonResult.currency),
    size: asString(metadata?.size),
  }
}

export function buildAnalyzeScrapedResultsPrompt(
  input: BuildAnalyzeScrapedResultsPromptInput,
): string {
  const outputLanguage = LOCALE_LANGUAGE_NAMES[input.locale]
  const routine = input.routineDescription?.trim() || "não informada"

  const resultsBlock = input.results
    .map((row) => JSON.stringify(toAnalyzePromptListing(row)))
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
