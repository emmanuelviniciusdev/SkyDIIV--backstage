import { createWorkflow } from "@upstash/workflow/cloudflare"
import { resetDbClients } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"
import {
  syncLanguagePayloadSchema,
  syncUserLanguageStep,
  type SyncLanguagePayload,
} from "./steps/sync-user-language"

export type { SyncLanguagePayload } from "./steps/sync-user-language"

/**
 * sync-language — Upstash Workflow (Cloudflare Workers)
 *
 * Registered in src/workflows/index.ts under the "language" key, which serveMany
 * exposes at POST /sync/language.
 *
 * Payload:
 *   {
 *     userid: string
 *     old_language: string
 *     new_language: string
 *   }
 */
export const syncLanguageWorkflow = createWorkflow<SyncLanguagePayload, void>(
  async (context) => {
    const parsed = syncLanguagePayloadSchema.safeParse(context.requestPayload)
    const log = createLogger(
      "sync-language",
      parsed.success ? parsed.data.userid : undefined,
    )

    if (!parsed.success) {
      log.error("Invalid workflow payload", { issues: parsed.error.issues })
      throw new Error("Workflow payload must include userid, old_language, and new_language")
    }

    const payload = parsed.data
    log.info("Workflow started", {
      old_language: payload.old_language,
      new_language: payload.new_language,
    })

    resetDbClients()
    log.debug("DB clients reset")

    log.info("Starting step: sync-user-language")
    const result = await context.run("sync-user-language", () => {
      return syncUserLanguageStep(payload)
    })
    log.info("Step completed: sync-user-language", result)

    log.info("Workflow completed")
  },
)
