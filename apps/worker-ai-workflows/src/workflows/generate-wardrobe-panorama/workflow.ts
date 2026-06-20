import { createWorkflow } from "@upstash/workflow/cloudflare"
import { checkWardrobeUpdateStep } from "./steps/check-wardrobe-update"
import { buildPromptStep } from "./steps/build-prompt"
import { executePromptStep } from "./steps/execute-prompt"
import { savePanoramaStep } from "./steps/save-panorama"
import { invalidateWardrobePanoramaCacheStep } from "./steps/invalidate-wardrobe-panorama-cache"
import { setWardrobePanoramaNotificationStep } from "./steps/set-wardrobe-panorama-notification"
import { resetDbClients } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"

export interface GenerateWardrobePanoramaPayload {
  userId: string
}

export const generateWardrobePanoramaWorkflow = createWorkflow<GenerateWardrobePanoramaPayload, void>(
  async (context) => {
    const { userId } = context.requestPayload
    const log = createLogger("workflow", userId)

    if (!userId) {
      log.error("Missing userId in workflow payload")
      throw new Error("Workflow payload must include a non-empty userId")
    }

    log.info("Workflow started")

    // Reset DB singletons so they pick up the bindings injected in index.ts.
    resetDbClients()
    log.debug("DB clients reset")

    // ── Step 1: Wardrobe update marker ──────────────────────────────────────
    log.info("Starting step: check-wardrobe-update")
    const shouldRun = await context.run("check-wardrobe-update", async () => {
      return checkWardrobeUpdateStep(userId)
    })
    if (!shouldRun) {
      log.info("Workflow skipped — wardrobe-update-check marker not present")
      return
    }
    log.info("Step completed: check-wardrobe-update")

    // ── Step 2: Build prompt ────────────────────────────────────────────────
    log.info("Starting step: build-prompt")
    const promptData = await context.run("build-prompt", async () => {
      return buildPromptStep(userId)
    })
    log.info("Step completed: build-prompt", {
      promptLength: promptData.prompt.length,
      totalPieces: promptData.wardrobeItems.length,
    })

    // ── Step 3: Execute prompt ──────────────────────────────────────────────
    log.info("Starting step: execute-prompt")
    const result = await context.run("execute-prompt", async () => {
      return executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })
    })
    log.info("Step completed: execute-prompt", { llmInteractionId: result.llmInteractionId })

    // ── Step 4: Save panorama ───────────────────────────────────────────────
    log.info("Starting step: save-panorama")
    await context.run("save-panorama", async () => {
      return savePanoramaStep({
        userId: promptData.userId,
        llmInteractionId: result.llmInteractionId,
        content: result.response,
      })
    })
    log.info("Step completed: save-panorama")

    // ── Step 5: Invalidate wardrobe panorama cache ──────────────────────────
    log.info("Starting step: invalidate-wardrobe-panorama-cache")
    await context.run("invalidate-wardrobe-panorama-cache", async () => {
      return invalidateWardrobePanoramaCacheStep(promptData.userId)
    })
    log.info("Step completed: invalidate-wardrobe-panorama-cache")

    // ── Step 6: Set unread notification ───────────────────────────────────────
    log.info("Starting step: set-wardrobe-panorama-notification")
    await context.run("set-wardrobe-panorama-notification", async () => {
      return setWardrobePanoramaNotificationStep(promptData.userId)
    })
    log.info("Step completed: set-wardrobe-panorama-notification")

    log.info("Workflow completed")
  },
)
