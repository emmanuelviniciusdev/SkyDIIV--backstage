import { describe, it, expect } from "vitest"
import { getFlowsForDay } from "../../src/flows/registry"
import { WEEKDAYS } from "../../src/flows/types"
import { weeklyOutfitsFlow } from "../../src/flows/weekly-outfits.flow"

describe("flow registry", () => {
  it("registers the weekly-outfits flow on sunday", () => {
    const flows = getFlowsForDay("sunday")
    expect(flows).toHaveLength(1)
    expect(flows[0]).toBe(weeklyOutfitsFlow)
  })

  it("supports multiple flows registered for the same day", () => {
    const flows = getFlowsForDay("sunday")
    expect(Array.isArray(flows)).toBe(true)
  })

  it("returns an empty array for days without registered flows", () => {
    const otherDays = WEEKDAYS.filter((day) => day !== "sunday")
    for (const day of otherDays) {
      expect(getFlowsForDay(day)).toEqual([])
    }
  })
})
