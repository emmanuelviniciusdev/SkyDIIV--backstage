import { getQStashClient } from "./qstash"
import { resolveWorkerSyncUrl, resolveWorkerAiWorkflowsUrl } from "./downstream-urls"
import type { OutboxEventRow } from "./db/outbox-events.repository"

/**
 * Known outbox flow identifiers — must match the values stored in `outbox_events.flow`
 * by the SkyDIIV web app (see `OUTBOX_FLOWS` in `app/lib/outbox.ts`).
 */
export const OUTBOX_FLOWS = {
  SYNC_LANGUAGE: "sync-language",
  GENERATE_WEEKLY_OUTFITS: "generate-weekly-outfits",
} as const

export type OutboxFlow = (typeof OUTBOX_FLOWS)[keyof typeof OUTBOX_FLOWS]

/**
 * Dispatches the outbox event to the appropriate downstream worker via QStash.
 *
 * The event `payload` is forwarded verbatim as the QStash message body —
 * it carries exactly the fields the downstream worker expects.
 *
 * Throws if the flow is unknown or QStash publish fails, so the caller can
 * return a 5xx and let QStash retry.
 */
export async function dispatch(event: OutboxEventRow): Promise<void> {
  const client = getQStashClient()

  switch (event.flow) {
    case OUTBOX_FLOWS.SYNC_LANGUAGE: {
      const url = resolveWorkerSyncUrl("/sync/language")
      await client.publishJSON({ url, body: event.payload })
      break
    }
    case OUTBOX_FLOWS.GENERATE_WEEKLY_OUTFITS: {
      const url = resolveWorkerAiWorkflowsUrl("/generate-weekly-outfits")
      await client.publishJSON({ url, body: event.payload })
      break
    }
    default: {
      throw new Error(`Unknown outbox flow: ${String(event.flow)}`)
    }
  }
}
