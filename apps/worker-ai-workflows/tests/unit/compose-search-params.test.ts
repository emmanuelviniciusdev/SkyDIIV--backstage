import { describe, it, expect } from "vitest"
import { composeSearchParams } from "../../src/lib/shopping/compose-search-params"
import type { ParsedSearchTermSuggestion } from "../../src/lib/shopping/suggestions"
import type { ShoppingSuggestionsPreferences } from "../../src/lib/db/shopping-suggestions-preferences.repository"

const SUGGESTIONS: ParsedSearchTermSuggestion[] = [
  { term: "blazer casual", sizeCategory: "top" },
  { term: "calça jeans reta", sizeCategory: "bottom" },
  { term: "tênis branco", sizeCategory: "foot" },
  { term: "cinto couro", sizeCategory: "none" },
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
        term: "blazer casual",
        gender: "Female",
        topSize: "M, G",
        bottomSize: null,
        footSize: null,
      },
      {
        term: "calça jeans reta",
        gender: "Female",
        topSize: null,
        bottomSize: "40",
        footSize: null,
      },
      {
        term: "tênis branco",
        gender: "Female",
        topSize: null,
        bottomSize: null,
        footSize: "38",
      },
      {
        term: "cinto couro",
        gender: "Female",
        topSize: null,
        bottomSize: null,
        footSize: null,
      },
    ])
  })

  it("publishes with null gender and sizes when preferences are missing", () => {
    expect(composeSearchParams(SUGGESTIONS.slice(0, 2), null)).toEqual([
      {
        term: "blazer casual",
        gender: null,
        topSize: null,
        bottomSize: null,
        footSize: null,
      },
      {
        term: "calça jeans reta",
        gender: null,
        topSize: null,
        bottomSize: null,
        footSize: null,
      },
    ])
  })
})
