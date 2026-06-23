import type { TranslatableWardrobePanorama } from "../../db/wardrobe-panorama.repository"

export interface BuildSyncWardrobePanoramaPromptInput {
  oldLanguage: string
  newLanguage: string
  record: TranslatableWardrobePanorama
}

/**
 * Builds a Portuguese prompt for translating wardrobe_panorama.content
 * from old_language to new_language.
 */
export function buildSyncWardrobePanoramaPrompt(
  input: BuildSyncWardrobePanoramaPromptInput,
): string {
  const recordJson = JSON.stringify(
    {
      id: input.record.id,
      content: input.record.content,
    },
    null,
    2,
  )

  return `
Você é um assistente de tradução do SkyDIIV.

Traduza o conteúdo abaixo do idioma "${input.oldLanguage}" para "${input.newLanguage}".

## Contexto

O texto pertence à tabela \`wardrobe_panorama\` — uma análise gerada por IA do guarda-roupa do usuário. Pode conter markdown, listas e parágrafos.

## Regras

- Preserve a estrutura markdown (títulos, listas, negrito, etc.)
- Preserve o tom e o significado
- Não invente informações
- Não altere o ID

## Entrada (JSON)

${recordJson}

## Saída

Retorne exclusivamente um JSON válido:

{
  "id": "...",
  "content": "..."
}
`.trim()
}
