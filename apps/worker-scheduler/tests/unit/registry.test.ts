import { describe, it, expect } from "vitest"
import { getFlowsForDay } from "../../src/flows/registry"
import { WEEKDAYS } from "../../src/flows/types"
import { weeklyOutfitsFlow } from "../../src/flows/weekly-outfits.flow"
import { generateWardrobePanoramaFlow } from "../../src/flows/generate-wardrobe-panorama.flow"
import { neonDatabaseSnapshotFlow } from "../../src/flows/neon-database-snapshot.flow"
import { generateSearchTermsProductsScrapingFlow } from "../../src/flows/generate-search-terms-products-scraping.flow"

describe("flow registry", () => {
  it("registers the weekly-outfits flow on sunday", () => {
    const flows = getFlowsForDay("sunday")
    expect(flows).toEqual([weeklyOutfitsFlow])
  })

  it("registers the neon-database-snapshot flow on wednesday", () => {
    const flows = getFlowsForDay("wednesday")
    expect(flows).toEqual([neonDatabaseSnapshotFlow])
  })

  it("registers the generate-wardrobe-panorama flow on thursday", () => {
    const flows = getFlowsForDay("thursday")
    expect(flows).toEqual([generateWardrobePanoramaFlow])
  })
  it("registers the generate-search-terms-products-scraping flow on friday", () => {
    const flows = getFlowsForDay("friday")
    expect(flows).toEqual([generateSearchTermsProductsScrapingFlow])
  })

  it("returns an empty array for days without registered flows", () => {
    const otherDays = WEEKDAYS.filter(
      (day) =>
        day !== "sunday" &&
        day !== "wednesday" &&
        day !== "thursday" &&
        day !== "friday",
    )
    for (const day of otherDays) {
      expect(getFlowsForDay(day)).toEqual([])
    }
  })
})
