import { describe, it, expect } from "vitest"
import { getFlowsForDay } from "../../src/flows/registry"
import { WEEKDAYS } from "../../src/flows/types"
import { weeklyOutfitsFlow } from "../../src/flows/weekly-outfits.flow"
import { generateWardrobePanoramaFlow } from "../../src/flows/generate-wardrobe-panorama.flow"

describe("flow registry", () => {
  it("registers the weekly-outfits flow on sunday", () => {
    const flows = getFlowsForDay("sunday")
    expect(flows).toEqual([weeklyOutfitsFlow])
  })

  it("registers the generate-wardrobe-panorama flow on thursday", () => {
    const flows = getFlowsForDay("thursday")
    expect(flows).toEqual([generateWardrobePanoramaFlow])
  })

  it("returns an empty array for days without registered flows", () => {
    const otherDays = WEEKDAYS.filter((day) => day !== "sunday" && day !== "thursday")
    for (const day of otherDays) {
      expect(getFlowsForDay(day)).toEqual([])
    }
  })
})
