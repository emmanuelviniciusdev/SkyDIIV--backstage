import type { Locale } from "../config"
import type { WardrobeItem } from "../../db/wardrobe.repository"
import type { WeeklyForecast } from "../../weather/types"
import { getLocaleMessages } from "../locales"
import { formatWeatherForecast } from "../weather/formatters"
import { buildWardrobeSummary } from "./wardrobe-summary"

const WEEKLY_OUTFIT_PROMPT_TEMPLATE = `
Você é um assistente de moda do SkyDIIV especializado em montar outfits semanais.

Sua única responsabilidade é selecionar peças de roupa para cada dia da semana utilizando exclusivamente as peças fornecidas na entrada.

## Entradas

### Guarda-roupa

O guarda-roupa é fornecido como uma lista de strings no formato:

ID:\${id} | TÍTULO:\${title} | TIPO:\${pieceType} | SUBTIPO:\${pieceSubtype} | TAGS:\${tags}

Os campos TIPO e SUBTIPO representam a categoria e subcategoria de cada peça (ex.: Top / T-Shirt, Bottom / Jeans). Esses valores estão sempre presentes e são fornecidos em inglês (en-US), independentemente do idioma do usuário. Os títulos e tags das peças podem estar em outros idiomas. As tags descrevem características adicionais da peça, incluindo estilo, ocasião, estação, temperatura adequada, cor, material ou qualquer outro atributo relevante.

{wardrobe}

### Resumo por tipo

{wardrobe_summary}

### Preferências do usuário

Texto livre contendo preferências, restrições ou objetivos de estilo.

{preferences}

### Previsão meteorológica

{weather_forecast}


## Objetivo

Gerar um outfit para cada dia da semana, de domingo a sábado.

Ao selecionar as peças:

* Utilize exclusivamente IDs existentes no guarda-roupa.
* Considere as preferências fornecidas pelo usuário.
* Considere as condições climáticas previstas para cada dia.
* Utilize o tipo e subtipo das peças para garantir montagens equilibradas (ex.: incluir uma peça Bottom quando houver uma Top selecionada).
* Utilize o resumo por tipo para garantir equilíbrio entre categorias de peças no conjunto da semana.
* Utilize as tags das peças para determinar adequação climática e visual.
* Priorize conforto, funcionalidade e coerência entre as peças selecionadas.
* Em dias frios, priorize peças associadas a frio, inverno ou proteção térmica.
* Em dias quentes, priorize peças leves e adequadas para calor.
* Em dias com chuva ou alta probabilidade de precipitação, priorize peças adequadas para clima úmido.
* Evite repetir exatamente a mesma combinação em dias diferentes quando houver alternativas viáveis.
* Não invente peças.
* Não invente IDs.
* Não utilize IDs que não existam na entrada.
* Cada outfit deve conter somente IDs das peças selecionadas.

## Saída

Retorne exclusivamente um JSON válido compatível com o seguinte schema:

Array<{
weekday: string;
clothing_piece_ids: string[];
}>

Exemplo:

[
{
"weekday": "sunday",
"clothing_piece_ids": ["12", "45", "91"]
},
{
"weekday": "monday",
"clothing_piece_ids": ["8", "33", "70"]
}
]

## Regras obrigatórias

* A resposta deve conter apenas o JSON.
* Não utilize markdown.
* Não utilize blocos de código.
* Não inclua explicações.
* Não inclua comentários.
* Não inclua texto antes ou depois do JSON.
* O array deve conter exatamente 7 elementos, um para cada dia da semana de domingo a sábado.
`

export interface BuildWeeklyOutfitsPromptInput {
  locale: Locale
  wardrobe: WardrobeItem[]
  preferences: string
  forecast: WeeklyForecast
}

export function buildWeeklyOutfitsPrompt(input: BuildWeeklyOutfitsPromptInput): string {
  const { fallbacks } = getLocaleMessages("pt-BR")

  const wardrobeBlock =
    input.wardrobe.length > 0
      ? input.wardrobe
          .map((item) => {
            const title = item.title.trim() || fallbacks.noTitle
            const tags = item.tags.length > 0 ? item.tags.join(", ") : fallbacks.noTags
            return `ID:${item.id} | TÍTULO:${title} | TIPO:${item.pieceType ?? ""} | SUBTIPO:${item.pieceSubtype ?? ""} | TAGS:${tags}`
          })
          .join("\n")
      : fallbacks.noWardrobe

  const summaryBlock = buildWardrobeSummary(input.wardrobe) || fallbacks.noPieces
  const weatherBlock = formatWeatherForecast(input.forecast, "pt-BR")
  const preferencesBlock = input.preferences.trim() || fallbacks.noPreferences

  return WEEKLY_OUTFIT_PROMPT_TEMPLATE.replace("{wardrobe}", wardrobeBlock)
    .replace("{wardrobe_summary}", summaryBlock)
    .replace("{preferences}", preferencesBlock)
    .replace("{weather_forecast}", weatherBlock)
}

/** @deprecated Use buildWeeklyOutfitsPrompt with locale instead. Kept for backward compatibility. */
export function getWeeklyOutfitsPromptTemplate(): string {
  return WEEKLY_OUTFIT_PROMPT_TEMPLATE
}
