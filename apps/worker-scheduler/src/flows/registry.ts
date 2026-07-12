import type { ScheduleFlow, Weekday } from "./types"
import { weeklyOutfitsFlow } from "./weekly-outfits.flow"
import { generateWardrobePanoramaFlow } from "./generate-wardrobe-panorama.flow"

/**
 * Maps each weekday to the list of flows it triggers.
 *
 * Multiple flows can be registered for the same day — they will all run in
 * parallel. Days without an entry have no flows yet; their endpoint still
 * verifies the QStash signature and responds 200.
 *
 * Flows with a dedicated endpoint (e.g. catch-up-outbox-events) are wired in
 * `src/index.ts` and do not appear here.
 *
 * To schedule a new job: implement a `ScheduleFlow` and append it to the
 * desired day's array (create the array if the day has none yet).
 */
export const flowRegistry: Partial<Record<Weekday, ScheduleFlow[]>> = {
  sunday: [weeklyOutfitsFlow],
  thursday: [generateWardrobePanoramaFlow],
}

export function getFlowsForDay(day: Weekday): ScheduleFlow[] {
  return flowRegistry[day] ?? []
}
