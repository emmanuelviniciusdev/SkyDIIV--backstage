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

/** One listing per search-term group, even when every ad is a weak match. */
export const ANALYZE_LEAST_BAD_SELECTION_INSTRUCTION =
  "Para cada grupo de anúncios do mesmo termo de busca, escolha sempre exatamente um anúncio: o mais relevante para o panorama e a rotina. Se nenhum for um bom encaixe, escolha mesmo assim o menos ruim daquele grupo. Nunca omita um grupo que tenha anúncios. Nunca devolva um array vazio quando houver anúncios disponíveis. Use somente ids fornecidos abaixo."

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

  const resultsBlock = formatListingGroups(input.results)

  return `
Você é um consultor de moda pessoal do SkyDIIV. Escolha, para cada grupo de anúncios do mesmo termo de busca, o anúncio mais relevante para o panorama do guarda-roupa.

Responda sempre em ${outputLanguage} apenas no raciocínio interno. A saída visível DEVE ser somente JSON.

Retorne APENAS um JSON (array). Sem markdown, sem comentários. Cada objeto:
- "searchTermScrapedProductId" (string): id do termo de busca
- "resultId" (string): id do anúncio escolhido para aquele termo

${ANALYZE_LEAST_BAD_SELECTION_INSTRUCTION}

ROTINA / ESTILO:
${routine}

---

PANORAMA DO GUARDA-ROUPA:
${input.panoramaContent.trim()}

---

ANÚNCIOS DISPONÍVEIS (um grupo por termo de busca):
${resultsBlock}
`.trim()
}

function formatListingGroups(results: UnprocessedScrapeResult[]): string {
  const groups = new Map<string, UnprocessedScrapeResult[]>()
  for (const row of results) {
    const existing = groups.get(row.searchTermId)
    if (existing) existing.push(row)
    else groups.set(row.searchTermId, [row])
  }

  return [...groups.entries()]
    .map(([searchTermId, rows]) => {
      const term = asString(rows[0]?.jsonSearch.term)
      const header = term ? `Grupo ${searchTermId} (termo: ${term}):` : `Grupo ${searchTermId}:`
      const listings = rows.map((row) => JSON.stringify(toAnalyzePromptListing(row))).join("\n")
      return `${header}\n${listings}`
    })
    .join("\n\n")
}
