import { getDb } from "../lib/db/client"
import { SqlUsersRepository } from "../lib/db/users.repository"
import { getQStashClient } from "../lib/qstash"
import { createLogger } from "../lib/logger"
import type { FlowResult, ScheduleFlow } from "./types"

/** Maximum number of messages in a single QStash batch call. */
const BATCH_SIZE = 100

export interface GenerateWardrobePanoramaPayload {
  userId: string
}

/**
 * Publishes one QStash message per eligible user to the worker-ai-workflows
 * generate-wardrobe-panorama endpoint (WARDROBE_PANORAMA_WORKER_URL, path included),
 * batching requests in groups of BATCH_SIZE (QStash limit: 100/call).
 *
 * Returns the total number of messages dispatched.
 */
export async function dispatchUsersToPanoramaWorkflow(users: { userId: string }[]): Promise<number> {
  if (users.length === 0) return 0

  const workerUrl = process.env.WARDROBE_PANORAMA_WORKER_URL
  if (!workerUrl) throw new Error("WARDROBE_PANORAMA_WORKER_URL environment variable is not set")

  const client = getQStashClient()
  let dispatched = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    const messages = batch.map((user) => ({
      url: workerUrl,
      body: { userId: user.userId } satisfies GenerateWardrobePanoramaPayload,
      headers: { "Content-Type": "application/json" },
    }))

    await client.batchJSON(messages)
    dispatched += batch.length
  }

  return dispatched
}

/**
 * Wardrobe panorama flow — scheduled on Thursday.
 *
 * 1. Query clothing_items to find users with >= 10 pieces.
 * 2. Batch-publish { userId } to the worker-ai-workflows generate-wardrobe-panorama
 *    endpoint via QStash.
 * 3. Report how many messages were dispatched.
 */
export const generateWardrobePanoramaFlow: ScheduleFlow = {
  name: "generate-wardrobe-panorama",

  async run(): Promise<FlowResult> {
    const log = createLogger("generate-wardrobe-panorama-flow")

    const db = getDb()
    const repo = new SqlUsersRepository(db)
    const users = await repo.findUsersWithWardrobeSizeAtLeast(10)
    log.info("Eligible users fetched", { count: users.length })

    if (users.length === 0) {
      log.warn("No users with >=10 wardrobe pieces found — nothing to dispatch")
      return { flow: this.name, dispatched: 0 }
    }

    const dispatched = await dispatchUsersToPanoramaWorkflow(users)
    log.info("Workflow dispatch complete", { dispatched })

    return { flow: this.name, dispatched }
  },
}
