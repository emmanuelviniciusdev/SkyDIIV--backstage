import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  setNewWardrobePanoramaNotification: vi.fn(),
}))

vi.mock("../../src/lib/cache/notification-cache", () => ({
  setNewWardrobePanoramaNotification: mocks.setNewWardrobePanoramaNotification,
}))

import { setWardrobePanoramaNotificationStep } from "../../src/workflows/generate-wardrobe-panorama/steps/set-wardrobe-panorama-notification"

describe("setWardrobePanoramaNotificationStep", () => {
  beforeEach(() => {
    mocks.setNewWardrobePanoramaNotification.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sets the wardrobe panorama notification for the user", async () => {
    mocks.setNewWardrobePanoramaNotification.mockResolvedValue(true)

    await setWardrobePanoramaNotificationStep("user-1")

    expect(mocks.setNewWardrobePanoramaNotification).toHaveBeenCalledWith("user-1")
  })

  it("does not throw when notification creation fails", async () => {
    mocks.setNewWardrobePanoramaNotification.mockRejectedValue(new Error("Redis unavailable"))

    await expect(setWardrobePanoramaNotificationStep("user-1")).resolves.toBeUndefined()
  })
})
