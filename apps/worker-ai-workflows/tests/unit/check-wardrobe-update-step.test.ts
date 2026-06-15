import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  hasWardrobeUpdateCheck: vi.fn(),
}))

vi.mock("../../src/lib/cache/wardrobe-panorama-cache", () => ({
  hasWardrobeUpdateCheck: mocks.hasWardrobeUpdateCheck,
}))

import { checkWardrobeUpdateStep } from "../../src/workflows/generate-wardrobe-panorama/steps/check-wardrobe-update"

describe("checkWardrobeUpdateStep", () => {
  beforeEach(() => {
    mocks.hasWardrobeUpdateCheck.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns true when the wardrobe update marker exists", async () => {
    mocks.hasWardrobeUpdateCheck.mockResolvedValue(true)

    await expect(checkWardrobeUpdateStep("user-1")).resolves.toBe(true)
    expect(mocks.hasWardrobeUpdateCheck).toHaveBeenCalledWith("user-1")
  })

  it("returns false when the wardrobe update marker is missing", async () => {
    mocks.hasWardrobeUpdateCheck.mockResolvedValue(false)

    await expect(checkWardrobeUpdateStep("user-1")).resolves.toBe(false)
  })
})
