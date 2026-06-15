import { createWorkflow } from "@upstash/workflow/cloudflare"
import { buildPromptStep } from "./steps/build-prompt"
import { executePromptStep } from "./steps/execute-prompt"
import { savePanoramaStep } from "./steps/save-panorama"
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

    // ── Step 1: Build prompt ────────────────────────────────────────────────
    log.info("Starting step: build-prompt")
    const promptData = await context.run("build-prompt", async () => {
      return buildPromptStep(userId)
    })
    log.info("Step completed: build-prompt", {
      promptLength: promptData.prompt.length,
      totalPieces: promptData.wardrobeItems.length,
    })

    // ── Step 2: Execute prompt ──────────────────────────────────────────────
    log.info("Starting step: execute-prompt")
    const result = await context.run("execute-prompt", async () => {
      return executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })
    })
    log.info("Step completed: execute-prompt", { llmInteractionId: result.llmInteractionId })

    // ── Step 3: Save panorama ───────────────────────────────────────────────
    log.info("Starting step: save-panorama")
    await context.run("save-panorama", async () => {
      return savePanoramaStep({
        userId: promptData.userId,
        llmInteractionId: result.llmInteractionId,
        content: result.response,
      })
    })
    log.info("Step completed: save-panorama")

    log.info("Workflow completed")
  },
)
