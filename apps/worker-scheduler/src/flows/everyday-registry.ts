import type { ScheduleFlow } from "./types"
import { neonDatabaseSnapshotFlow } from "./neon-database-snapshot.flow"

/**
 * Flows registered for POST /schedule/everyday.
 *
 * Multiple flows can share this endpoint — they run in parallel. One flow
 * failing never stops the others. Register new daily jobs here; no routing
 * changes are needed.
 */
export const everydayFlowRegistry: ScheduleFlow[] = [neonDatabaseSnapshotFlow]

export function getEverydayFlows(): ScheduleFlow[] {
  return everydayFlowRegistry
}
