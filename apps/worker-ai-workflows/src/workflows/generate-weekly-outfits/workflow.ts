import { createWorkflow } from "@upstash/workflow/cloudflare"
import { buildPromptStep } from "./steps/build-prompt"
import { executePromptStep } from "./steps/execute-prompt"
import { saveOutfitsStep } from "./steps/save-outfits"
import { generateImageStep } from "./steps/generate-images"
import { invalidateWeeklyOutfitsCacheStep } from "./steps/invalidate-weekly-outfits-cache"
import { setWeeklyOutfitsNotificationStep } from "./steps/set-weekly-outfits-notification"
import { resetDbClients } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"

export interface GenerateWeeklyOutfitsPayload {
  userId: string
}

function getCurrentWeekStartDate(): string {
  const now = new Date()
  const dayOfWeek = now.getUTCDay()
  const sundayMs = now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000
  return new Date(sundayMs).toISOString().split("T")[0]
}

/**
 * generate-weekly-outfits — Upstash Workflow (Cloudflare Workers)
 *
 * Registered in src/workflows/index.ts under the "generate-weekly-outfits" key,
 * which serveMany exposes at POST /generate-weekly-outfits.
 *
 * Durable steps:
 *   1. build-prompt   — loads preferences, wardrobe, weather → builds LLM prompt.
 *   2. execute-prompt — calls the LLM; validates and parses JSON suggestions.
 *   3. save-outfits   — persists outfits + creative-board layout to the DB.
 *   4. generate-image — CF Images board-position PNG → R2 → outfits.image_url
 *                       (one step per outfit, before cache invalidation).
 *   5. invalidate-weekly-outfits-cache — clears the skydiiv web app Redis cache.
 *   6. set-weekly-outfits-notification — marks new weekly outfits as unread.
 */
export const generateWeeklyOutfitsWorkflow = createWorkflow<GenerateWeeklyOutfitsPayload, void>(
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
      const weekStartDate = getCurrentWeekStartDate()
      return buildPromptStep(userId, weekStartDate)
    })
    log.info("Step completed: build-prompt", {
      weekStartDate: promptData.weekStartDate,
      promptLength: promptData.prompt.length,
      weatherDays: Object.keys(promptData.dayWeatherByWeekday).length,
    })

    // ── Step 2: Execute prompt ──────────────────────────────────────────────
    log.info("Starting step: execute-prompt")
    const suggestions = await context.run("execute-prompt", async () => {
      return executePromptStep({ userId: promptData.userId, prompt: promptData.prompt })
    })
    log.info("Step completed: execute-prompt", { suggestionCount: suggestions.length })

    // ── Step 3: Save outfits ────────────────────────────────────────────────
    log.info("Starting step: save-outfits")
    const savedOutfits = await context.run("save-outfits", async () => {
      return saveOutfitsStep({
        userId: promptData.userId,
        weeklyOutfitPreferencesId: promptData.weeklyOutfitPreferencesId,
        weekStartDate: promptData.weekStartDate,
        suggestions,
        dayWeatherByWeekday: promptData.dayWeatherByWeekday,
        validClothingItemIds: promptData.validClothingItemIds,
      })
    })
    log.info("Step completed: save-outfits", { savedCount: savedOutfits.length })

    // ── Step 4: Generate thumbnails (one CF Images call per outfit) ─────────
    // Runs before cache invalidation so the web app does not cache null image_url.
    // Each outfit runs in its own workflow step so it gets a fresh Worker
    // invocation — and therefore a fresh CPU budget — for the async binding call.
    log.info("Starting steps: generate-image", { outfitCount: savedOutfits.length })
    let imageGeneratedCount = 0
    for (const outfit of savedOutfits) {
      const generated = await context.run(`generate-image-${outfit.outfitId}`, async () => {
        return generateImageStep({
          userId: promptData.userId,
          outfit,
          wardrobeImageMap: promptData.wardrobeImageMap,
        })
      })
      if (generated) imageGeneratedCount++
    }
    log.info("Steps completed: generate-image", {
      outfitCount: savedOutfits.length,
      imageGeneratedCount,
      skippedCount: savedOutfits.length - imageGeneratedCount,
    })

    // ── Step 5: Invalidate web app cache ───────────────────────────────────
    log.info("Starting step: invalidate-weekly-outfits-cache")
    await context.run("invalidate-weekly-outfits-cache", async () => {
      await invalidateWeeklyOutfitsCacheStep({
        userId: promptData.userId,
        weekStartDate: promptData.weekStartDate,
      })
    })
    log.info("Step completed: invalidate-weekly-outfits-cache")

    // ── Step 6: Set unread notification ─────────────────────────────────────
    log.info("Starting step: set-weekly-outfits-notification")
    await context.run("set-weekly-outfits-notification", async () => {
      await setWeeklyOutfitsNotificationStep(promptData.userId)
    })
    log.info("Step completed: set-weekly-outfits-notification")

    log.info("Workflow completed", {
      weekStartDate: promptData.weekStartDate,
      suggestionCount: suggestions.length,
      savedCount: savedOutfits.length,
      imageGeneratedCount,
    })
  },
)
