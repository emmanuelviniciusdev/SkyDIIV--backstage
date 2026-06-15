import { getDb } from "../lib/db/client"
import { SqlUsersRepository } from "../lib/db/users.repository"
import type { EligibleUser } from "../lib/db/users.repository"
import { getQStashClient } from "../lib/qstash"
import { createLogger } from "../lib/logger"
import type { FlowResult, ScheduleFlow } from "./types"

/** Maximum number of messages in a single QStash batch call. */
const BATCH_SIZE = 100

export interface GenerateWeeklyOutfitsPayload {
  userId: string
}

/**
 * Publishes one QStash message per eligible user to the weekly-outfits worker
 * URL, batching requests in groups of BATCH_SIZE (QStash limit: 100/call).
 *
 * Returns the total number of messages dispatched.
 */
export async function dispatchUsersToWorkflow(users: EligibleUser[]): Promise<number> {
  if (users.length === 0) return 0

  const workerUrl = process.env.WEEKLY_OUTFITS_WORKER_URL
  if (!workerUrl) throw new Error("WEEKLY_OUTFITS_WORKER_URL environment variable is not set")

  const client = getQStashClient()
  let dispatched = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    const messages = batch.map((user) => ({
      url: workerUrl,
      body: { userId: user.userId } satisfies GenerateWeeklyOutfitsPayload,
      headers: { "Content-Type": "application/json" },
    }))

    await client.batchJSON(messages)
    dispatched += batch.length
  }

  return dispatched
}

/**
 * Weekly outfits flow — registered on Sunday.
 *
 * 1. Query weekly_outfit_preferences for all users with preferences defined.
 * 2. Batch-publish { userId } to the weekly-outfits workflow worker via QStash.
 * 3. Report how many messages were dispatched.
 */
export const weeklyOutfitsFlow: ScheduleFlow = {
  name: "weekly-outfits",

  async run(): Promise<FlowResult> {
    const log = createLogger("weekly-outfits-flow")

    const db = getDb()
    const repo = new SqlUsersRepository(db)
    const users = await repo.findUsersWithOutfitPreferences()
    log.info("Eligible users fetched", { count: users.length })

    if (users.length === 0) {
      log.warn("No users with outfit preferences found — nothing to dispatch")
      return { flow: this.name, dispatched: 0 }
    }

    const dispatched = await dispatchUsersToWorkflow(users)
    log.info("Workflow dispatch complete", { dispatched })

    return { flow: this.name, dispatched }
  },
}
