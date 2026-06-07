import { getDb } from "./lib/db/client"
import { SqlUsersRepository } from "./lib/db/users.repository"
import { dispatchUsersToWorkflow, getQStashReceiver } from "./lib/qstash"
import { createLogger } from "./lib/logger"

/**
 * Scheduler handler — triggered by the Upstash QStash CRON.
 *
 * CRON schedule: every Sunday at 21:00 UTC (= 18:00 BRT / Brasília)
 * QStash expression: "0 21 * * 0"
 *
 * Flow:
 *   1. Verify the incoming request is signed by QStash (prevents unauthorised triggers).
 *   2. Query weekly_outfit_preferences for all users with preferences defined.
 *   3. Batch-publish { userId } to the weekly-outfits workflow worker via QStash.
 *   4. Return { dispatched } for observability.
 */
export async function handleSchedule(request: Request): Promise<Response> {
  const log = createLogger("scheduler")

  // ── Step 1: Verify QStash signature ────────────────────────────────────────
  const signature = request.headers.get("upstash-signature")
  if (!signature) {
    log.warn("Missing upstash-signature header — rejecting request")
    return new Response("Unauthorized", { status: 401 })
  }

  const body = await request.text()

  try {
    const receiver = getQStashReceiver()
    const isValid = await receiver.verify({
      signature,
      body,
      url: request.url,
    })

    if (!isValid) {
      log.warn("Invalid QStash signature — rejecting request")
      return new Response("Unauthorized", { status: 401 })
    }
  } catch (err) {
    log.error("Signature verification failed", { error: String(err) })
    return new Response("Unauthorized", { status: 401 })
  }

  log.info("QStash signature verified — starting schedule run")

  // ── Step 2: Query eligible users ────────────────────────────────────────────
  let userIds: string[]
  try {
    const db = getDb()
    const repo = new SqlUsersRepository(db)
    const users = await repo.findUsersWithOutfitPreferences()
    userIds = users.map((u) => u.userId)
    log.info("Eligible users fetched", { count: userIds.length })
  } catch (err) {
    log.error("Failed to query eligible users", { error: String(err) })
    return Response.json({ error: "Failed to query eligible users" }, { status: 500 })
  }

  if (userIds.length === 0) {
    log.warn("No users with outfit preferences found — nothing to dispatch")
    return Response.json({ dispatched: 0 })
  }

  // ── Step 3: Dispatch to workflow worker ─────────────────────────────────────
  let dispatched: number
  try {
    dispatched = await dispatchUsersToWorkflow(
      userIds.map((userId) => ({ userId })),
    )
    log.info("Workflow dispatch complete", { dispatched })
  } catch (err) {
    log.error("Failed to dispatch users to workflow", { error: String(err) })
    return Response.json({ error: "Failed to dispatch users to workflow" }, { status: 500 })
  }

  return Response.json({ dispatched })
}
