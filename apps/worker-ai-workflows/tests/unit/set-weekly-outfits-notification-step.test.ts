import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  setNewWeeklyOutfitsNotification: vi.fn(),
}))

vi.mock("../../src/lib/cache/notification-cache", () => ({
  setNewWeeklyOutfitsNotification: mocks.setNewWeeklyOutfitsNotification,
}))

import { setWeeklyOutfitsNotificationStep } from "../../src/workflows/generate-weekly-outfits/steps/set-weekly-outfits-notification"

describe("setWeeklyOutfitsNotificationStep", () => {
  beforeEach(() => {
    mocks.setNewWeeklyOutfitsNotification.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sets the weekly outfits notification for the user", async () => {
    mocks.setNewWeeklyOutfitsNotification.mockResolvedValue(true)

    await setWeeklyOutfitsNotificationStep("user-1")

    expect(mocks.setNewWeeklyOutfitsNotification).toHaveBeenCalledWith("user-1")
  })

  it("does not throw when notification creation fails", async () => {
    mocks.setNewWeeklyOutfitsNotification.mockRejectedValue(new Error("Redis unavailable"))

    await expect(setWeeklyOutfitsNotificationStep("user-1")).resolves.toBeUndefined()
  })
})
