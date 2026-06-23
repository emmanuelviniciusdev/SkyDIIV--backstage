import { z } from "zod"

export const syncLanguagePayloadSchema = z.object({
  userid: z.string().min(1),
  old_language: z.string().min(1),
  new_language: z.string().min(1),
})

export type SyncLanguagePayload = z.infer<typeof syncLanguagePayloadSchema>

export interface SyncLanguageResult {
  userid: string
  old_language: string
  new_language: string
}

/**
 * Boilerplate step for the sync-language workflow.
 *
 * Propagates user language changes across SkyDIIV data stores. Replace the
 * placeholder body with the actual sync logic (DB updates, cache invalidation,
 * downstream notifications, etc.).
 */
export function syncUserLanguageStep(payload: SyncLanguagePayload): SyncLanguageResult {
  // TODO: implement language sync (preferences, cached content, derived data, …)
  return {
    userid: payload.userid,
    old_language: payload.old_language,
    new_language: payload.new_language,
  }
}
