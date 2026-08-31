import { describe, expect, it } from "vitest"
import {
  buildEnjoeiSearchUrl,
  mapGenderToEnjoeiDepartment,
  parseSizeList,
  toEnjoeiBrandSlug,
  toEnjoeiSizeSlug,
} from "../../src/infrastructure/scraping/marketplaces/enjoei-search-url.js"
import { searchParams } from "../helpers/search-params.js"

describe("parseSizeList", () => {
  it("splits comma-separated sizes and trims", () => {
    expect(parseSizeList("M, G")).toEqual(["M", "G"])
    expect(parseSizeList("40")).toEqual(["40"])
    expect(parseSizeList(null)).toEqual([])
    expect(parseSizeList("")).toEqual([])
  })
})

describe("toEnjoeiSizeSlug", () => {
  it("lowercases letter sizes and keeps numeric tokens", () => {
    expect(toEnjoeiSizeSlug("M")).toBe("m")
    expect(toEnjoeiSizeSlug("PP")).toBe("pp")
    expect(toEnjoeiSizeSlug("40")).toBe("40")
    expect(toEnjoeiSizeSlug("XGG+")).toBe("xgg+")
  })
})

describe("toEnjoeiBrandSlug", () => {
  it("lowercases and kebab-cases brand names", () => {
    expect(toEnjoeiBrandSlug("Zara")).toBe("zara")
    expect(toEnjoeiBrandSlug("Emporio Armani")).toBe("emporio-armani")
    expect(toEnjoeiBrandSlug("  Youcom  ")).toBe("youcom")
  })
})

describe("mapGenderToEnjoeiDepartment", () => {
  it("maps Female/Male to Enjoei department slugs", () => {
    expect(mapGenderToEnjoeiDepartment("Female")).toBe("feminino")
    expect(mapGenderToEnjoeiDepartment("Male")).toBe("masculino")
    expect(mapGenderToEnjoeiDepartment("feminino")).toBe("feminino")
  })

  it("omits department for null and no-preference", () => {
    expect(mapGenderToEnjoeiDepartment(null)).toBeNull()
    expect(mapGenderToEnjoeiDepartment("No preference")).toBeNull()
    expect(mapGenderToEnjoeiDepartment("Unknown")).toBeNull()
  })
})

describe("buildEnjoeiSearchUrl", () => {
  it("builds a query-only URL when filters are null", () => {
    expect(buildEnjoeiSearchUrl(searchParams("vestido floral"))).toBe(
      "https://www.enjoei.com.br/s/?q=vestido+floral",
    )
  })

  it("adds department, brand, and size filters from SearchParams", () => {
    const url = buildEnjoeiSearchUrl(
      searchParams("camiseta", {
        gender: "Female",
        topSize: "M, G",
        bottomSize: "40",
        footSize: "38",
        brand: "Emporio Armani",
      }),
    )

    expect(url).toBe(
      "https://www.enjoei.com.br/s/?q=camiseta&dep=feminino&b=emporio-armani&sc=m&sc=g&sw=40&ss=38",
    )
  })

  it("omits size and brand params when they are null", () => {
    const url = buildEnjoeiSearchUrl(
      searchParams("jaqueta", {
        gender: "Male",
        topSize: null,
        bottomSize: null,
        footSize: null,
        brand: null,
      }),
    )

    expect(url).toBe("https://www.enjoei.com.br/s/?q=jaqueta&dep=masculino")
  })
})
