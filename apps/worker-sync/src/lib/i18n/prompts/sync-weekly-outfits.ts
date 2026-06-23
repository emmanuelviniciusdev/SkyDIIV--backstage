import type { TranslatableWeeklyOutfit } from "../../db/weekly-outfits.repository"

export interface BuildSyncWeeklyOutfitsPromptInput {
  oldLanguage: string
  newLanguage: string
  records: TranslatableWeeklyOutfit[]
}

/**
 * Builds a Portuguese prompt for translating weekly_outfits text fields
 * (weather_summary, description_temperature) from old_language to new_language.
 */
export function buildSyncWeeklyOutfitsPrompt(input: BuildSyncWeeklyOutfitsPromptInput): string {
  const recordsJson = JSON.stringify(
    input.records.map((record) => ({
      id: record.id,
      weather_summary: record.weather_summary,
      description_temperature: record.description_temperature,
    })),
    null,
    2,
  )

  return `
Você é um assistente de tradução do SkyDIIV.

Traduza os textos abaixo do idioma "${input.oldLanguage}" para "${input.newLanguage}".

## Contexto

Os textos pertencem à tabela \`weekly_outfits\` e descrevem condições meteorológicas associadas a outfits semanais gerados por IA.

Campos:
- \`weather_summary\`: resumo compacto do clima do dia
- \`description_temperature\`: descrição textual da temperatura

## Regras

- Preserve o tom, formato e nível de detalhe do original
- Não invente informações
- Mantenha valores numéricos, unidades e códigos inalterados quando presentes no texto
- Se um campo estiver \`null\` no JSON de entrada, retorne \`null\` no campo correspondente
- Não altere os IDs
- Retorne exatamente um objeto por registro de entrada

## Entrada (JSON)

${recordsJson}

## Saída

Retorne exclusivamente um JSON válido — um array com os mesmos objetos, traduzidos:

[
  {
    "id": "...",
    "weather_summary": "...",
    "description_temperature": "..."
  }
]
`.trim()
}
