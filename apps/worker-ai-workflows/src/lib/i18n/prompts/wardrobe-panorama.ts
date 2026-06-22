import type { Locale } from "../config"
import type { UserPreferences } from "../../db/preferences.repository"
import type { WardrobeItem } from "../../db/wardrobe.repository"
import { getLocaleMessages } from "../locales"

export interface BuildWardrobePanoramaPromptInput {
  locale: Locale
  userName: string
  preferences: UserPreferences | null
  wardrobe: WardrobeItem[]
}

interface PanoramaPromptParts {
  intro: string
  formatting: string
  sectionBalance: string
  sectionStyle: string
  sectionShopping: string
  important: string
  userDataHeader: string
  nameLabel: string
  preferencesHeader: string
  wardrobeHeader: string
  totalPiecesLabel: string
  piecesLabel: string
}

const PROMPT_PARTS: Record<Locale, PanoramaPromptParts> = {
  "pt-BR": {
    intro:
      "Você é um consultor de moda pessoal do SkyDIIV. Com base nos dados do guarda-roupa e nas preferências do usuário abaixo, gere um panorama mensal em português brasileiro com tom amigável, direto e levemente editorial.",
    formatting:
      "O panorama deve ser retornado em Markdown, usando ## para títulos de seção e negrito para destacar informações relevantes. Escreva em parágrafos corridos — sem listas, sem bullets. Use linguagem próxima, como se fosse um personal stylist falando diretamente com o usuário. Trate o usuário pelo nome informado abaixo quando apropriado.\n\nCubra exatamente estas seções, nesta ordem:",
    sectionBalance: `## equilíbrio do guarda-roupa
Com base nas peças e suas tags, identifique padrões de concentração e lacunas. Aponte o que parece estar em excesso e o que pode estar faltando para montar outfits completos. Se as preferências do usuário estiverem disponíveis, considere sua rotina e localização ao interpretar os dados.`,
    sectionStyle: `## seu estilo
Com base nos títulos e tags das peças, descreva o estilo predominante do usuário em 2-3 frases. Se o usuário tiver descrito seu próprio estilo nas preferências, aponte convergências ou divergências interessantes entre o que ele descreveu e o que o guarda-roupa revela.`,
    sectionShopping: `## o que vale buscar
Com base nos padrões identificados, sugira de 2 a 4 tipos de peça que complementariam o guarda-roupa. Se as preferências estiverem disponíveis, leve em conta a rotina e a localização do usuário. Seja específico: mencione o tipo de peça e o contexto de uso. Nunca sugira compras sem antes justificar a lacuna que preencheriam.`,
    important:
      "Importante: use apenas os dados fornecidos. Não invente informações nem categorize as peças além do que os títulos e tags permitem inferir. Se as preferências do usuário não estiverem definidas, faça a análise exclusivamente com base nos dados do guarda-roupa, sem especular sobre rotina ou estilo de vida.",
    userDataHeader: "DADOS DO USUÁRIO:",
    nameLabel: "Nome",
    preferencesHeader: "PREFERÊNCIAS DO USUÁRIO:",
    wardrobeHeader: "DADOS DO GUARDA-ROUPA:",
    totalPiecesLabel: "Total de peças",
    piecesLabel: "Peças",
  },
  "es-PE": {
    intro:
      "Eres un consultor de moda personal de SkyDIIV. Con base en los datos del guardarropa y las preferencias del usuario a continuación, genera un panorama mensual en español peruano con un tono amigable, directo y ligeramente editorial.",
    formatting:
      "El panorama debe devolverse en Markdown, usando ## para títulos de sección y negrita para resaltar información relevante. Escribe en párrafos continuos — sin listas, sin viñetas. Usa un lenguaje cercano, como si fueras un personal stylist hablando directamente con el usuario. Trata al usuario por el nombre indicado abajo cuando sea apropiado.\n\nCubre exactamente estas secciones, en este orden:",
    sectionBalance: `## equilibrio del guardarropa
Con base en las prendas y sus etiquetas, identifica patrones de concentración y vacíos. Señala lo que parece estar en exceso y lo que puede faltar para armar outfits completos. Si las preferencias del usuario están disponibles, considera su rutina y ubicación al interpretar los datos.`,
    sectionStyle: `## tu estilo
Con base en los títulos y etiquetas de las prendas, describe el estilo predominante del usuario en 2-3 frases. Si el usuario describió su propio estilo en las preferencias, señala convergencias o divergencias interesantes entre lo que describió y lo que revela el guardarropa.`,
    sectionShopping: `## qué vale buscar
Con base en los patrones identificados, sugiere de 2 a 4 tipos de prenda que complementarían el guardarropa. Si las preferencias están disponibles, ten en cuenta la rutina y la ubicación del usuario. Sé específico: menciona el tipo de prenda y el contexto de uso. Nunca sugieras compras sin justificar antes el vacío que llenarían.`,
    important:
      "Importante: usa solo los datos proporcionados. No inventes información ni categorices las prendas más allá de lo que los títulos y etiquetas permiten inferir. Si las preferencias del usuario no están definidas, haz el análisis exclusivamente con base en los datos del guardarropa, sin especular sobre rutina o estilo de vida.",
    userDataHeader: "DATOS DEL USUARIO:",
    nameLabel: "Nombre",
    preferencesHeader: "PREFERENCIAS DEL USUARIO:",
    wardrobeHeader: "DATOS DEL GUARDARROPA:",
    totalPiecesLabel: "Total de prendas",
    piecesLabel: "Prendas",
  },
  "en-US": {
    intro:
      "You are a SkyDIIV personal fashion consultant. Based on the wardrobe data and user preferences below, generate a monthly panorama in American English with a friendly, direct, and slightly editorial tone.",
    formatting:
      "The panorama must be returned in Markdown, using ## for section titles and bold for relevant highlights. Write in flowing paragraphs — no lists, no bullets. Use approachable language, as if you were a personal stylist speaking directly to the user. Address the user by the name provided below when appropriate.\n\nCover exactly these sections, in this order:",
    sectionBalance: `## wardrobe balance
Based on the items and their tags, identify concentration patterns and gaps. Point out what seems excessive and what may be missing to build complete outfits. If user preferences are available, consider their routine and location when interpreting the data.`,
    sectionStyle: `## your style
Based on item titles and tags, describe the user's predominant style in 2-3 sentences. If the user described their own style in preferences, highlight interesting convergences or divergences between what they described and what the wardrobe reveals.`,
    sectionShopping: `## what's worth looking for
Based on the identified patterns, suggest 2 to 4 types of items that would complement the wardrobe. If preferences are available, take the user's routine and location into account. Be specific: mention the item type and usage context. Never suggest purchases without first justifying the gap they would fill.`,
    important:
      "Important: use only the provided data. Do not invent information or categorize items beyond what titles and tags allow you to infer. If user preferences are not set, analyze exclusively based on wardrobe data, without speculating about routine or lifestyle.",
    userDataHeader: "USER DATA:",
    nameLabel: "Name",
    preferencesHeader: "USER PREFERENCES:",
    wardrobeHeader: "WARDROBE DATA:",
    totalPiecesLabel: "Total items",
    piecesLabel: "Items",
  },
}

export function buildWardrobePanoramaPrompt(input: BuildWardrobePanoramaPromptInput): string {
  const messages = getLocaleMessages(input.locale)
  const { fallbacks, wardrobePanorama } = messages
  const parts = PROMPT_PARTS[input.locale]

  const userName = input.userName.trim() || fallbacks.userNameUnknown

  const preferencesSection = input.preferences
    ? wardrobePanorama.preferencesSection(
        input.preferences.location ?? fallbacks.locationUndefined,
        input.preferences.routineDescription ?? fallbacks.routineUndefined,
      )
    : fallbacks.preferencesUndefined

  const total = input.wardrobe.length
  const piecesBlock =
    total > 0
      ? input.wardrobe
          .map((item) => {
            const title = (item.title || "").replace(/\n/g, " ").trim() || fallbacks.noTitlePanorama
            const tagsArr = Array.isArray(item.tags) ? item.tags : []
            const tags = tagsArr.length > 0 ? tagsArr.join(", ") : fallbacks.noTagsPanorama
            return wardrobePanorama.wardrobeLine(item.id, title, tags)
          })
          .join("\n")
      : fallbacks.noPieces

  return `
    ${parts.intro}
    
    ${parts.formatting}
    
    ${parts.sectionBalance}
    
    ${parts.sectionStyle}
    
    ${parts.sectionShopping}
    
    ${parts.important}
    
    ---
    
    ${parts.userDataHeader}
    ${parts.nameLabel}: ${userName}
    
    ---
    
    ${parts.preferencesHeader}
    ${preferencesSection}
    
    ---
    
    ${parts.wardrobeHeader}
    
    ${parts.totalPiecesLabel}: ${total}
    
    ${parts.piecesLabel}:
    ${piecesBlock}
`
}
