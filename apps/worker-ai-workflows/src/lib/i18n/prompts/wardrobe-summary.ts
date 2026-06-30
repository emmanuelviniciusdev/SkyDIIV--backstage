import type { WardrobeItem } from "../../db/wardrobe.repository"

/**
 * Builds a pt-BR summary of wardrobe items grouped by type and subtype.
 * Types and subtypes are always en-US values (domain names).
 */
export function buildWardrobeSummary(wardrobe: WardrobeItem[]): string {
  if (wardrobe.length === 0) return ""

  const typeCounts = new Map<string, Map<string, number>>()

  for (const item of wardrobe) {
    if (!item.pieceType) continue
    if (!typeCounts.has(item.pieceType)) {
      typeCounts.set(item.pieceType, new Map())
    }
    const subtypeMap = typeCounts.get(item.pieceType)!
    const subtype = item.pieceSubtype ?? "(sem subtipo)"
    subtypeMap.set(subtype, (subtypeMap.get(subtype) ?? 0) + 1)
  }

  if (typeCounts.size === 0) return ""

  const typeEntries = [...typeCounts.entries()]
    .map(([type, subtypeMap]) => {
      const typeTotal = [...subtypeMap.values()].reduce((a, b) => a + b, 0)
      return { type, subtypeMap, typeTotal }
    })
    .sort((a, b) => b.typeTotal - a.typeTotal)

  const total = typeEntries.reduce((sum, e) => sum + e.typeTotal, 0)

  const lines = typeEntries.map(({ type, subtypeMap, typeTotal }) => {
    const subtypeDetails = [...subtypeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([subtype, count]) => `${subtype} (${count})`)
      .join(", ")
    return `- ${type}: ${typeTotal} ${typeTotal === 1 ? "peça" : "peças"} → ${subtypeDetails}`
  })

  return `${lines.join("\n")}\nTotal: ${total} ${total === 1 ? "peça" : "peças"}`
}
