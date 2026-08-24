import { describe, it, expect } from "vitest"
import { getEverydayFlows } from "../../src/flows/everyday-registry"

describe("everyday flow registry", () => {
  it("has no registered flows", () => {
    expect(getEverydayFlows()).toEqual([])
  })
})
