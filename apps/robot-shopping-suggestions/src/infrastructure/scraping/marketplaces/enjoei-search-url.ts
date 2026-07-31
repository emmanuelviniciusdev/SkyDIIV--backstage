import type { SearchParams } from "../../../domain/entities/search-params.js"

export const ENJOEI_ORIGIN = "https://www.enjoei.com.br"

/**
 * Maps SkyDIIV shopping-suggestions gender values to Enjoei department slugs.
 * "No preference" (and unknown values) omit the department filter.
 */
const GENDER_TO_DEPARTMENT: Record<string, string> = {
  female: "feminino",
  male: "masculino",
  feminino: "feminino",
  masculino: "masculino",
}

/**
 * Parses a stored size list ("M, G" or "40") into individual tokens.
 */
export function parseSizeList(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Enjoei size option slugs are lowercase (e.g. "m", "pp", "40").
 */
export function toEnjoeiSizeSlug(size: string): string {
  return size.trim().toLowerCase()
}

/**
 * Enjoei brand filter slugs are lowercase kebab-case (e.g. "emporio-armani").
 */
export function toEnjoeiBrandSlug(brand: string): string {
  return brand
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Resolves a SkyDIIV gender preference to an Enjoei `dep` slug, or null when
 * the department filter should be omitted.
 */
export function mapGenderToEnjoeiDepartment(gender: string | null): string | null {
  if (!gender) return null
  const key = gender.trim().toLowerCase()
  if (!key || key === "no preference" || key === "no-preference") {
    return null
  }
  return GENDER_TO_DEPARTMENT[key] ?? null
}

/**
 * Builds an Enjoei search URL with advanced filters.
 *
 * Query params (from Enjoei `abbr-params-map`):
 * - `q`  — search term
 * - `dep` — department / gender (feminino | masculino)
 * - `b`  — brand slug
 * - `sc` — clothes / top sizes (repeat)
 * - `sw` — waist / bottom sizes (repeat)
 * - `ss` — shoes / foot sizes (repeat)
 */
export function buildEnjoeiSearchUrl(params: SearchParams): string {
  const url = new URL(`${ENJOEI_ORIGIN}/s/`)
  url.searchParams.set("q", params.searchTerm)

  const department = mapGenderToEnjoeiDepartment(params.gender)
  if (department) {
    url.searchParams.set("dep", department)
  }

  if (params.brand?.trim()) {
    const brandSlug = toEnjoeiBrandSlug(params.brand)
    if (brandSlug) {
      url.searchParams.set("b", brandSlug)
    }
  }

  for (const size of parseSizeList(params.topSize)) {
    url.searchParams.append("sc", toEnjoeiSizeSlug(size))
  }
  for (const size of parseSizeList(params.bottomSize)) {
    url.searchParams.append("sw", toEnjoeiSizeSlug(size))
  }
  for (const size of parseSizeList(params.footSize)) {
    url.searchParams.append("ss", toEnjoeiSizeSlug(size))
  }

  return url.toString()
}
