import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  buildDailySnapshotName,
  createSnapshot,
  deleteSnapshot,
  listProjectSnapshots,
  rotateNeonSnapshot,
} from "../../src/lib/neon/snapshots"
import type { NeonConfig } from "../../src/lib/neon/config"

const CONFIG: NeonConfig = {
  apiKey: "neon-api-key",
  projectId: "proj-1",
  branchId: "branch-main",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("neon snapshots client", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("buildDailySnapshotName uses the UTC date", () => {
    expect(buildDailySnapshotName(new Date("2026-07-13T15:30:00Z"))).toBe(
      "skydiiv-daily-2026-07-13",
    )
  })

  it("listProjectSnapshots returns parsed snapshots", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        snapshots: [
          { id: "snap-1", name: "old" },
          { id: "snap-2", name: "other" },
        ],
      }),
    )

    const snapshots = await listProjectSnapshots(CONFIG, fetchFn)

    expect(snapshots).toEqual([
      { id: "snap-1", name: "old" },
      { id: "snap-2", name: "other" },
    ])
    expect(fetchFn).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/proj-1/snapshots",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("deleteSnapshot calls the Neon delete endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({}))

    await deleteSnapshot(CONFIG, "snap-1", fetchFn)

    expect(fetchFn).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/proj-1/snapshots/snap-1",
      expect.objectContaining({ method: "DELETE" }),
    )
  })

  it("createSnapshot posts the snapshot name to the branch endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({ snapshot: { id: "snap-new", name: "skydiiv-daily-2026-07-13" } }),
    )

    const snapshot = await createSnapshot(CONFIG, "skydiiv-daily-2026-07-13", fetchFn)

    expect(snapshot).toEqual({ id: "snap-new", name: "skydiiv-daily-2026-07-13" })
    expect(fetchFn).toHaveBeenCalledWith(
      "https://console.neon.tech/api/v2/projects/proj-1/branches/branch-main/snapshot",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "skydiiv-daily-2026-07-13" }),
      }),
    )
  })

  it("rotateNeonSnapshot deletes existing snapshots before creating a new one", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ snapshots: [{ id: "snap-old", name: "old" }] }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({ snapshot: { id: "snap-new", name: "skydiiv-daily-2026-07-13" } }),
      )

    const result = await rotateNeonSnapshot("skydiiv-daily-2026-07-13", fetchFn, CONFIG)

    expect(result).toEqual({
      deletedSnapshotIds: ["snap-old"],
      createdSnapshot: { id: "snap-new", name: "skydiiv-daily-2026-07-13" },
    })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it("retries createSnapshot when Neon returns 423 Locked", async () => {
    vi.useFakeTimers()

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "locked" }, 423))
      .mockResolvedValueOnce(
        jsonResponse({ snapshot: { id: "snap-new", name: "skydiiv-daily-2026-07-13" } }),
      )

    const promise = createSnapshot(CONFIG, "skydiiv-daily-2026-07-13", fetchFn)
    await vi.advanceTimersByTimeAsync(1_000)
    const snapshot = await promise

    expect(snapshot.id).toBe("snap-new")
    expect(fetchFn).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it("throws when createSnapshot keeps failing", async () => {
    vi.useFakeTimers()

    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: "locked" }, 423))

    const promise = createSnapshot(CONFIG, "daily", fetchFn)
    const assertion = expect(promise).rejects.toThrow("Failed to create Neon snapshot (423)")

    await vi.runAllTimersAsync()
    await assertion
    expect(fetchFn).toHaveBeenCalledTimes(5)

    vi.useRealTimers()
  })
})
