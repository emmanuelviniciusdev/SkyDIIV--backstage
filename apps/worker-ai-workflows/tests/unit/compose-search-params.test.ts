import { describe, it, expect } from "vitest"
import { composeSearchParams } from "../../src/lib/shopping/compose-search-params"
import type { ParsedShoppingSuggestion } from "../../src/lib/prompt/panorama-response"
import type { ShoppingSuggestionsPreferences } from "../../src/lib/db/shopping-suggestions-preferences.repository"

const SUGGESTIONS: ParsedShoppingSuggestion[] = [
  { searchTerm: "blazer casual", brand: "Zara", sizeCategory: "top" },
  { searchTerm: "calça jeans reta", brand: null, sizeCategory: "bottom" },
  { searchTerm: "tênis branco", brand: "Nike", sizeCategory: "foot" },
  { searchTerm: "cinto couro", brand: null, sizeCategory: "none" },
]

const PREFS: ShoppingSuggestionsPreferences = {
  gender: "Female",
  topSize: "M, G",
  bottomSize: "40",
  footSize: "38",
}

describe("composeSearchParams()", () => {
  it("applies gender and only the size matching sizeCategory", () => {
    expect(composeSearchParams(SUGGESTIONS, PREFS)).toEqual([
      {
        searchTerm: "blazer casual",
        gender: "Female",
        topSize: "M, G",
        bottomSize: null,
        footSize: null,
        brand: "Zara",
      },
      {
        searchTerm: "calça jeans reta",
        gender: "Female",
        topSize: null,
        bottomSize: "40",
        footSize: null,
        brand: null,
      },
      {
        searchTerm: "tênis branco",
        gender: "Female",
        topSize: null,
        bottomSize: null,
        footSize: "38",
        brand: "Nike",
      },
      {
        searchTerm: "cinto couro",
        gender: "Female",
        topSize: null,
        bottomSize: null,
        footSize: null,
        brand: null,
      },
    ])
  })

  it("publishes with null gender and sizes when preferences are missing", () => {
    expect(composeSearchParams(SUGGESTIONS.slice(0, 2), null)).toEqual([
      {
        searchTerm: "blazer casual",
        gender: null,
        topSize: null,
        bottomSize: null,
        footSize: null,
        brand: "Zara",
      },
      {
        searchTerm: "calça jeans reta",
        gender: null,
        topSize: null,
        bottomSize: null,
        footSize: null,
        brand: null,
      },
    ])
  })
})
