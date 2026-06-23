import { createWorkflow } from "@upstash/workflow/cloudflare"
import { resetDbClients } from "../../lib/db/client"
import { executePromptStep } from "../../lib/llm/execute-prompt"
import { createLogger } from "../../lib/logger"
import { loadTranslatableRecordsStep } from "./steps/load-translatable-records"
import { buildWeeklyOutfitsPromptStep } from "./steps/weekly-outfits/build-prompt"
import { saveWeeklyOutfitsTranslationsStep } from "./steps/weekly-outfits/save-translations"
import { buildWardrobePanoramaPromptStep } from "./steps/wardrobe-panorama/build-prompt"
import { saveWardrobePanoramaTranslationStep } from "./steps/wardrobe-panorama/save-translation"
import { invalidateSyncLanguageCacheStep } from "./steps/invalidate-sync-language-cache"
import { syncLanguagePayloadSchema, type SyncLanguagePayload, type SyncLanguageResult } from "./types"

export type { SyncLanguagePayload } from "./types"

/**
 * sync-language — Upstash Workflow (Cloudflare Workers)
 *
 * Each translation target (weekly_outfits, wardrobe_panorama) runs its own
 * three-step flow: build-prompt → execute-prompt → save.
 * A final step clears the web app's running-sync-language Redis marker.
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

    log.info("Starting step: load-translatable-records")
    const records = await context.run("load-translatable-records", async () => {
      return loadTranslatableRecordsStep(payload.userid)
    })
    log.info("Step completed: load-translatable-records", {
      weeklyOutfitsCount: records.weeklyOutfits.length,
      hasWardrobePanorama: records.wardrobePanorama !== null,
    })

    let weeklyOutfitsTranslated = 0
    if (records.weeklyOutfits.length > 0) {
      log.info("Starting step: weekly-outfits-build-prompt")
      const promptData = await context.run("weekly-outfits-build-prompt", () => {
        return buildWeeklyOutfitsPromptStep({
          userId: payload.userid,
          oldLanguage: payload.old_language,
          newLanguage: payload.new_language,
          records: records.weeklyOutfits,
        })
      })
      log.info("Step completed: weekly-outfits-build-prompt", {
        promptLength: promptData.prompt.length,
      })

      log.info("Starting step: weekly-outfits-execute-prompt")
      const llmResult = await context.run("weekly-outfits-execute-prompt", async () => {
        return executePromptStep({
          userId: promptData.userId,
          prompt: promptData.prompt,
          step: "weekly-outfits-execute-prompt",
        })
      })
      log.info("Step completed: weekly-outfits-execute-prompt", {
        responseLength: llmResult.response.length,
      })

      log.info("Starting step: weekly-outfits-save-translations")
      const saveResult = await context.run("weekly-outfits-save-translations", async () => {
        return saveWeeklyOutfitsTranslationsStep({
          userId: promptData.userId,
          sourceRecords: promptData.records,
          rawResponse: llmResult.response,
        })
      })
      weeklyOutfitsTranslated = saveResult.translatedCount
      log.info("Step completed: weekly-outfits-save-translations", saveResult)
    } else {
      log.info("Skipping weekly_outfits flow (no records)")
    }

    let wardrobePanoramaTranslated = false
    if (records.wardrobePanorama) {
      log.info("Starting step: wardrobe-panorama-build-prompt")
      const promptData = await context.run("wardrobe-panorama-build-prompt", () => {
        return buildWardrobePanoramaPromptStep({
          userId: payload.userid,
          oldLanguage: payload.old_language,
          newLanguage: payload.new_language,
          record: records.wardrobePanorama!,
        })
      })
      log.info("Step completed: wardrobe-panorama-build-prompt", {
        promptLength: promptData.prompt.length,
      })

      log.info("Starting step: wardrobe-panorama-execute-prompt")
      const llmResult = await context.run("wardrobe-panorama-execute-prompt", async () => {
        return executePromptStep({
          userId: promptData.userId,
          prompt: promptData.prompt,
          step: "wardrobe-panorama-execute-prompt",
        })
      })
      log.info("Step completed: wardrobe-panorama-execute-prompt", {
        responseLength: llmResult.response.length,
      })

      log.info("Starting step: wardrobe-panorama-save-translation")
      const saveResult = await context.run("wardrobe-panorama-save-translation", async () => {
        return saveWardrobePanoramaTranslationStep({
          userId: promptData.userId,
          sourceRecord: promptData.record,
          rawResponse: llmResult.response,
        })
      })
      wardrobePanoramaTranslated = saveResult.translated
      log.info("Step completed: wardrobe-panorama-save-translation", saveResult)
    } else {
      log.info("Skipping wardrobe_panorama flow (no record)")
    }

    log.info("Starting step: invalidate-sync-language-cache")
    await context.run("invalidate-sync-language-cache", async () => {
      return invalidateSyncLanguageCacheStep(payload.userid)
    })
    log.info("Step completed: invalidate-sync-language-cache")

    const result: SyncLanguageResult = {
      userid: payload.userid,
      old_language: payload.old_language,
      new_language: payload.new_language,
      weeklyOutfitsLoaded: records.weeklyOutfits.length,
      weeklyOutfitsTranslated,
      wardrobePanoramaTranslated,
    }

    log.info("Workflow completed", result)
  },
)
