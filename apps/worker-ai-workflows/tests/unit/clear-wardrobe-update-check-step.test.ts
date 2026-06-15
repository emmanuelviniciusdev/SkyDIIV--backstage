import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  clearWardrobeUpdateCheck: vi.fn(),
}))

vi.mock("../../src/lib/cache/wardrobe-update-check-cache", () => ({
  clearWardrobeUpdateCheck: mocks.clearWardrobeUpdateCheck,
}))

import { clearWardrobeUpdateCheckStep } from "../../src/workflows/generate-wardrobe-panorama/steps/clear-wardrobe-update-check"

describe("clearWardrobeUpdateCheckStep", () => {
  beforeEach(() => {
    mocks.clearWardrobeUpdateCheck.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("clears the wardrobe update marker for the user", async () => {
    mocks.clearWardrobeUpdateCheck.mockResolvedValue(true)

    await clearWardrobeUpdateCheckStep("user-1")

    expect(mocks.clearWardrobeUpdateCheck).toHaveBeenCalledWith("user-1")
  })

  it("does not throw when cache clearing fails", async () => {
    mocks.clearWardrobeUpdateCheck.mockRejectedValue(new Error("Redis unavailable"))

    await expect(clearWardrobeUpdateCheckStep("user-1")).resolves.toBeUndefined()
  })
})
