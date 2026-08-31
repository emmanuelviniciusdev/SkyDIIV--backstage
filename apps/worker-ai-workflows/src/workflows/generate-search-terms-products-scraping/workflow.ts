import { createWorkflow } from "@upstash/workflow/cloudflare"
import { parseWardrobePanoramaIdPayload } from "../../lib/automatic-thrifting/payload"
import { resetDbClients } from "../../lib/db/client"
import { createLogger } from "../../lib/logger"
import { skipIfUnprocessedSearchTermsStep } from "./steps/skip-if-unprocessed"
import { loadGenerateSearchTermsContextStep } from "./steps/load-context"
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
    log.info("No eligible marketplace for locale — exiting without writes", {
      locale: ctx.locale,
      wardrobePanoramaId,
    })
    return
  }

  const prompt = await context.run("build-prompt", () =>
    Promise.resolve(buildGenerateSearchTermsPromptStep(ctx)),
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
