import { buildDailySnapshotName, rotateNeonSnapshot } from "../lib/neon/snapshots"
import { createLogger } from "../lib/logger"
import type { FlowResult, ScheduleFlow } from "./types"

/**
 * Rotates the Neon manual database snapshot (delete existing → create new).
 *
 * Intended for daily execution via POST /schedule/everyday. On the Neon Free
 * plan only one manual snapshot is allowed, so rotation is required.
 */
export const neonDatabaseSnapshotFlow: ScheduleFlow = {
  name: "neon-database-snapshot",

  async run(): Promise<FlowResult> {
    const log = createLogger("neon-database-snapshot-flow")
    const snapshotName = buildDailySnapshotName()

    log.info("Rotating Neon snapshot", { snapshotName })

    const { deletedSnapshotIds, createdSnapshot } = await rotateNeonSnapshot(snapshotName)

    log.info("Neon snapshot rotation complete", {
      deletedCount: deletedSnapshotIds.length,
      createdSnapshotId: createdSnapshot.id,
      createdSnapshotName: createdSnapshot.name,
    })

    return {
      flow: this.name,
      deletedSnapshotIds,
      createdSnapshotId: createdSnapshot.id,
      createdSnapshotName: createdSnapshot.name,
    }
  },
}
