import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockRotateNeonSnapshot, mockBuildDailySnapshotName } = vi.hoisted(() => ({
  mockRotateNeonSnapshot: vi.fn(),
  mockBuildDailySnapshotName: vi.fn(),
}))

vi.mock("../../src/lib/neon/snapshots", () => ({
  rotateNeonSnapshot: mockRotateNeonSnapshot,
  buildDailySnapshotName: mockBuildDailySnapshotName,
}))

import { neonDatabaseSnapshotFlow } from "../../src/flows/neon-database-snapshot.flow"

describe("neonDatabaseSnapshotFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildDailySnapshotName.mockReturnValue("skydiiv-daily-2026-07-13")
  })

  it("rotates the Neon snapshot and returns the result fields", async () => {
    mockRotateNeonSnapshot.mockResolvedValueOnce({
      deletedSnapshotIds: ["snap-old"],
      createdSnapshot: { id: "snap-new", name: "skydiiv-daily-2026-07-13" },
    })

    const result = await neonDatabaseSnapshotFlow.run()

    expect(mockRotateNeonSnapshot).toHaveBeenCalledWith("skydiiv-daily-2026-07-13")
    expect(result).toEqual({
      flow: "neon-database-snapshot",
      deletedSnapshotIds: ["snap-old"],
      createdSnapshotId: "snap-new",
      createdSnapshotName: "skydiiv-daily-2026-07-13",
    })
  })

  it("propagates Neon API errors", async () => {
    mockRotateNeonSnapshot.mockRejectedValueOnce(new Error("Neon API unavailable"))

    await expect(neonDatabaseSnapshotFlow.run()).rejects.toThrow("Neon API unavailable")
  })
})
