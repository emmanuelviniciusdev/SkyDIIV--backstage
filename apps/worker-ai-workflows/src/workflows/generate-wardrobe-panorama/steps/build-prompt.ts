import { getReadDb } from "../../../lib/db/client"
import { SqlWardrobeRepository } from "../../../lib/db/wardrobe.repository"
import { SqlPreferencesRepository } from "../../../lib/db/preferences.repository"
import { createLogger } from "../../../lib/logger"

export interface BuildPromptResult {
  userId: string
  prompt: string
  wardrobeItems: { id: string; title: string; tags: string[] }[]
  validClothingItemIds: string[]
}

export async function buildPromptStep(userId: string): Promise<BuildPromptResult> {
  const log = createLogger("build-prompt-panorama", userId)
  const db = getReadDb()
  const wardrobeRepo = new SqlWardrobeRepository(db)
  const preferencesRepo = new SqlPreferencesRepository(db)

  log.info("Loading preferences")
  const preferences = await preferencesRepo.findByUserId(userId)
  log.info("Loading wardrobe")
  const wardrobe = await wardrobeRepo.findByUserId(userId)

  const preferencesSection = preferences
    ? `Localização: ${preferences.location ?? "não definida"}\nDescrição da rotina/estilo: ${preferences.routineDescription ?? "não definida"}`
    : "não definidas"

  const total = wardrobe.length
  const piecesBlock =
    total > 0
      ? wardrobe
          .map((item) => {
            const title = (item.title || "").replace(/\n/g, " ").trim() || "sem título"
            const tagsArr = Array.isArray(item.tags) ? item.tags : []
            const tags = tagsArr.length > 0 ? tagsArr.join(", ") : "sem tags"
            return `ID: ${item.id} Título: ${title}; Tags: ${tags}`
          })
          .join("\n")
      : "Nenhuma peça cadastrada."

  const prompt = `
    Você é um consultor de moda pessoal do SkyDIIV. Com base nos dados do guarda-roupa e nas preferências do usuário abaixo, gere um panorama mensal em português brasileiro com tom amigável, direto e levemente editorial.
    
    O panorama deve ser retornado em Markdown, usando ## para títulos de seção e negrito para destacar informações relevantes. Escreva em parágrafos corridos — sem listas, sem bullets. Use linguagem próxima, como se fosse um personal stylist falando diretamente com o usuário.
    
    Cubra exatamente estas seções, nesta ordem:
    
    ## equilíbrio do guarda-roupa
    Com base nas peças e suas tags, identifique padrões de concentração e lacunas. Aponte o que parece estar em excesso e o que pode estar faltando para montar outfits completos. Se as preferências do usuário estiverem disponíveis, considere sua rotina e localização ao interpretar os dados.
    
    ## seu estilo
    Com base nos títulos e tags das peças, descreva o estilo predominante do usuário em 2-3 frases. Se o usuário tiver descrito seu próprio estilo nas preferências, aponte convergências ou divergências interessantes entre o que ele descreveu e o que o guarda-roupa revela.
    
    ## o que vale buscar
    Com base nos padrões identificados, sugira de 2 a 4 tipos de peça que complementariam o guarda-roupa. Se as preferências estiverem disponíveis, leve em conta a rotina e a localização do usuário. Seja específico: mencione o tipo de peça e o contexto de uso. Nunca sugira compras sem antes justificar a lacuna que preencheriam.
    
    Importante: use apenas os dados fornecidos. Não invente informações nem categorize as peças além do que os títulos e tags permitem inferir. Se as preferências do usuário não estiverem definidas, faça a análise exclusivamente com base nos dados do guarda-roupa, sem especular sobre rotina ou estilo de vida.
    
    ---
    
    PREFERÊNCIAS DO USUÁRIO:
    ${preferencesSection}
    
    ---
    
    DADOS DO GUARDA-ROUPA:
    
    Total de peças: ${total}
    
    Peças:
    ${piecesBlock}
`

  log.info("Built prompt", { totalPieces: total, promptLength: prompt.length })

  return {
    userId,
    prompt,
    wardrobeItems: wardrobe.map((i) => ({ id: i.id, title: i.title, tags: i.tags })),
    validClothingItemIds: wardrobe.map((i) => i.id),
  }
}
