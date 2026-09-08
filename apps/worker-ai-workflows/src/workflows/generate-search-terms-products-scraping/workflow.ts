import { createWorkflow } from "@upstash/workflow/cloudflare"
import { parseWardrobePanoramaIdPayload } from "../../lib/automatic-thrifting/payload"
import { resetDbClients } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"
import { skipIfUnprocessedSearchTermsStep } from "./steps/skip-if-unprocessed"
import { loadGenerateSearchTermsContextStep } from "./steps/load-context"
import { planFeedbackSummaryStep } from "./steps/plan-feedback-summary"
import { summarizeFeedbackChunkStep } from "./steps/summarize-feedback-chunk"
import { persistFeedbackSummaryStep } from "./steps/persist-feedback-summary"
import { buildGenerateSearchTermsPromptStep } from "./steps/build-prompt"
import { executeGenerateSearchTermsPromptStep } from "./steps/execute-prompt"
import { insertSearchTermsStep } from "./steps/insert-search-terms"

export interface GenerateSearchTermsProductsScrapingPayload {
  wardrobePanoramaId: string
}

export const generateSearchTermsProductsScrapingWorkflow = createWorkflow<
  GenerateSearchTermsProductsScrapingPayload,
  void
>(async (context) => {
  const wardrobePanoramaId = parseWardrobePanoramaIdPayload(context.requestPayload)
  const log = createLogger("generate-search-terms-products-scraping")

  log.info("Workflow started", { wardrobePanoramaId })
  resetDbClients()

  const hasUnprocessed = await context.run("skip-if-unprocessed", async () => {
    return skipIfUnprocessedSearchTermsStep(wardrobePanoramaId)
  })
  if (hasUnprocessed) {
    log.info("Workflow skipped — unprocessed search terms already exist")
    return
  }

  const ctx = await context.run("load-context", async () => {
    return loadGenerateSearchTermsContextStep(wardrobePanoramaId)
  })

  if (ctx.eligibleMarketplaces.length === 0) {
    log.info("No eligible marketplace — exiting without writes", {
      locale: ctx.locale,
      wardrobePanoramaId,
    })
    return
  }

  const plan = await context.run("plan-feedback-summary", async () => {
    return planFeedbackSummaryStep(ctx.userId)
  })

  let feedbackSummary = ""
  if (plan.action === "clear-stale-empty") {
    await context.run("persist-feedback-summary", async () => {
      await persistFeedbackSummaryStep({
        userId: ctx.userId,
        summary: "",
        readAtIso: plan.readAtIso,
        clearStaleEmpty: true,
      })
    })
  } else if (plan.action === "reuse") {
    feedbackSummary = plan.reusedSummary
  } else if (plan.action === "refresh") {
    let running = ""
    for (let i = 0; i < plan.chunkCount; i++) {
      running = await context.run(`summarize-feedback-chunk-${i}`, async () => {
        return summarizeFeedbackChunkStep({
          userId: ctx.userId,
          locale: ctx.locale,
          chunkIndex: i,
          chunkSize: plan.chunkSize,
          maxEntries: plan.maxEntries,
          priorSummary: running,
        })
      })
    }
    await context.run("persist-feedback-summary", async () => {
      await persistFeedbackSummaryStep({
        userId: ctx.userId,
        summary: running,
        readAtIso: plan.readAtIso,
      })
    })
    feedbackSummary = running
  }

  const prompt = await context.run("build-prompt", () =>
    Promise.resolve(buildGenerateSearchTermsPromptStep(ctx, feedbackSummary)),
  )

  const result = await context.run("execute-prompt", async () => {
    return executeGenerateSearchTermsPromptStep({ userId: ctx.userId, prompt })
  })

  const inserted = await context.run("insert-search-terms", async () => {
    return insertSearchTermsStep({
      wardrobePanoramaId,
      llmInteractionId: result.llmInteractionId,
      suggestions: result.suggestions,
      shoppingPreferences: ctx.shoppingPreferences,
      eligibleMarketplaces: ctx.eligibleMarketplaces,
    })
  })

  log.info("Workflow completed", { inserted })
})
