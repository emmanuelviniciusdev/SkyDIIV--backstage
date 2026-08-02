import type { Locale } from "../config"
import type { UserPreferences } from "../../db/preferences.repository"
import type { WardrobeItem } from "../../db/wardrobe.repository"
import { getLocaleMessages } from "../locales"
import { buildWardrobeSummary } from "./wardrobe-summary"

export interface BuildWardrobePanoramaPromptInput {
  locale: Locale
  userName: string
  preferences: UserPreferences | null
  wardrobe: WardrobeItem[]
}

const LOCALE_LANGUAGE_NAMES: Record<Locale, string> = {
  "pt-BR": "português brasileiro",
  "es-PE": "espanhol peruano",
  "en-US": "inglês americano",
}

const PROMPT_PARTS = {
  intro: (outputLanguage: string) =>
    `Você é um consultor de moda pessoal do SkyDIIV. Com base nos dados do guarda-roupa e nas preferências do usuário abaixo, gere um panorama mensal com tom amigável, direto e levemente editorial. Responda sempre em ${outputLanguage}.`,

  formatting:
    "O panorama deve ser retornado em Markdown, usando ## para títulos de seção e negrito para destacar informações relevantes. Escreva em parágrafos corridos — sem listas, sem bullets. Use linguagem próxima, como se fosse um personal stylist falando diretamente com o usuário. Trate o usuário pelo nome informado abaixo quando apropriado.\n\nCubra exatamente estas seções, nesta ordem:",

  sectionBalance: `## equilíbrio do guarda-roupa
Com base nas peças, seus tipos, subtipos e tags, identifique padrões de concentração e lacunas. Utilize o resumo por tipo para identificar proporções e desequilíbrios. Aponte o que parece estar em excesso e o que pode estar faltando para montar outfits completos. Se as preferências do usuário estiverem disponíveis, considere sua rotina e localização ao interpretar os dados.`,

  sectionStyle: `## seu estilo
Com base nos títulos, tipos, subtipos e tags das peças, descreva o estilo predominante do usuário em 2-3 frases. Se o usuário tiver descrito seu próprio estilo nas preferências, aponte convergências ou divergências interessantes entre o que ele descreveu e o que o guarda-roupa revela.`,

  sectionShopping: `## o que vale buscar
Com base nos padrões identificados, sugira de 2 a 4 tipos de peça que complementariam o guarda-roupa. Se as preferências estiverem disponíveis, leve em conta a rotina e a localização do usuário. Seja específico: mencione o tipo de peça e o contexto de uso. Nunca sugira compras sem antes justificar a lacuna que preencheriam.`,

  shoppingSuggestionsJson: `Após o panorama em Markdown, emita EXATAMENTE um bloco JSON cercado por \`\`\`json e \`\`\` (e nada depois dele). O JSON deve ser um array com no mínimo 2 e no máximo 5 objetos, alinhados às lacunas descritas em "## o que vale buscar". Cada objeto deve ter:
- "searchTerm" (string): termo de busca avançado, específico e pronto para busca em marketplace de roupas de segunda mão (ex.: "blazer casual bege oversized", "tênis branco minimalista"). Escreva o termo no mesmo idioma da resposta.
- "brand" (string ou null): marca sugerida quando fizer sentido; caso contrário null.
- "sizeCategory" (string): uma de "top" | "bottom" | "foot" | "none" — indica qual filtro de tamanho se aplica à peça (top = parte de cima, bottom = parte de baixo, foot = calçados, none = sem tamanho específico, ex. acessórios).

Não inclua gender, tamanhos numéricos/letras, marketplace, URLs ou campos extras. O Markdown do panorama deve vir ANTES do bloco JSON e NÃO deve conter o JSON dentro das seções.`,

  important:
    "Importante: use apenas os dados fornecidos. Os títulos e tags dos itens podem estar no idioma do usuário — não os traduza. Utilize os campos Tipo e Subtipo para categorizar as peças — esses valores estão sempre em inglês (en-US), independentemente do idioma do usuário. Se as preferências do usuário não estiverem definidas, faça a análise exclusivamente com base nos dados do guarda-roupa, sem especular sobre rotina ou estilo de vida.",

  userDataHeader: "DADOS DO USUÁRIO:",
  nameLabel: "Nome",
  preferencesHeader: "PREFERÊNCIAS DO USUÁRIO:",
  wardrobeHeader: "DADOS DO GUARDA-ROUPA:",
  wardrobeFormatNote:
    "Tipo e Subtipo identificam a categoria e subcategoria de cada peça. Os valores estão sempre presentes e em inglês (en-US), independentemente do idioma do usuário (ex.: Top, Bottom, T-Shirt, Jeans). Os títulos e tags das peças podem estar em outros idiomas.",
  summaryHeader: "RESUMO POR TIPO:",
  piecesHeader: "PEÇAS:",
}

export function buildWardrobePanoramaPrompt(input: BuildWardrobePanoramaPromptInput): string {
  const { fallbacks } = getLocaleMessages("pt-BR")
  const outputLanguage = LOCALE_LANGUAGE_NAMES[input.locale]
  const userName = input.userName.trim() || fallbacks.userNameUnknown

  const preferencesSection = input.preferences
    ? `Localização: ${input.preferences.location ?? fallbacks.locationUndefined}\nDescrição da rotina/estilo: ${input.preferences.routineDescription ?? fallbacks.routineUndefined}`
    : fallbacks.preferencesUndefined

  const total = input.wardrobe.length
  const summary = buildWardrobeSummary(input.wardrobe)

  const piecesBlock =
    total > 0
      ? input.wardrobe
          .map((item) => {
            const title = (item.title || "").replace(/\n/g, " ").trim() || fallbacks.noTitlePanorama
            const tagsArr = Array.isArray(item.tags) ? item.tags : []
            const tags = tagsArr.length > 0 ? tagsArr.join(", ") : fallbacks.noTagsPanorama
            return `ID: ${item.id} Título: ${title}; Tipo: ${item.pieceType ?? ""}; Subtipo: ${item.pieceSubtype ?? ""}; Tags: ${tags}`
          })
          .join("\n")
      : fallbacks.noPieces

  return `
    ${PROMPT_PARTS.intro(outputLanguage)}
    
    ${PROMPT_PARTS.formatting}
    
    ${PROMPT_PARTS.sectionBalance}
    
    ${PROMPT_PARTS.sectionStyle}
    
    ${PROMPT_PARTS.sectionShopping}
    
    ${PROMPT_PARTS.shoppingSuggestionsJson}
    
    ${PROMPT_PARTS.important}
    
    ---
    
    ${PROMPT_PARTS.userDataHeader}
    ${PROMPT_PARTS.nameLabel}: ${userName}
    
    ---
    
    ${PROMPT_PARTS.preferencesHeader}
    ${preferencesSection}
    
    ---
    
    ${PROMPT_PARTS.wardrobeHeader}
    
    ${PROMPT_PARTS.wardrobeFormatNote}
    
    ${PROMPT_PARTS.summaryHeader}
    ${summary || fallbacks.noPieces}
    
    ${PROMPT_PARTS.piecesHeader}
    ${piecesBlock}
`
}
