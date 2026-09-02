import { createWorkflow } from "@upstash/workflow/cloudflare"
import { parseWardrobePanoramaIdPayload } from "../../lib/automatic-thrifting/payload"
import { resetDbClients, getWriteDb } from "../../lib/db/client"
import {
  SqlScrapedProductsSwapRepository,
  uniqueSearchTermIds,
} from "../../lib/db/scraped-products-swap.repository"
import { notifyShoppingSuggestionsReady } from "../../lib/cache/shopping-suggestions-cache"
import { buildAnalyzeScrapedResultsPrompt } from "../../lib/i18n/prompts/analyze-scraped-results"
import { createLogger } from "../../lib/logger"
import { loadAnalyzeContextStep } from "./steps/load-context"
import { executeAnalyzePromptStep } from "./steps/execute-prompt"
import { buildChosenProductInserts } from "./steps/map-chosen-listings"

export interface AnalyzeScrapedProductsResultsPayload {
  wardrobePanoramaId: string
}

export const analyzeScrapedProductsResultsWorkflow = createWorkflow<
  AnalyzeScrapedProductsResultsPayload,
  void
>(async (context) => {
  const wardrobePanoramaId = parseWardrobePanoramaIdPayload(context.requestPayload)
  const log = createLogger("analyze-scraped-products-results")

  log.info("Workflow started", { wardrobePanoramaId })
  resetDbClients()

  const ctx = await context.run("load-unprocessed-results", async () => {
    return loadAnalyzeContextStep(wardrobePanoramaId)
  })

  if (ctx.results.length === 0) {
    log.info("No unprocessed results — keeping last week's products and registers")
    return
  }

  const prompt = await context.run("build-prompt", () =>
    Promise.resolve(
      buildAnalyzeScrapedResultsPrompt({
        locale: ctx.locale,
        panoramaContent: ctx.panoramaContent,
        routineDescription: ctx.routineDescription,
        results: ctx.results,
      }),
    ),
  )

  const result = await context.run("execute-prompt", async () => {
    return executeAnalyzePromptStep({ userId: ctx.userId, prompt })
  })

  const products = buildChosenProductInserts(result.chosen, ctx.results)
  if (products.length === 0) {
    log.info("LLM chose zero listings — keeping last week's products and registers")
    return
  }

  await context.run("swap-scraped-products", async () => {
    const repo = new SqlScrapedProductsSwapRepository(getWriteDb())
    await repo.swapForPanorama({
      wardrobePanoramaId,
      products,
      keepSearchTermIds: uniqueSearchTermIds(ctx.results),
    })
  })

  await context.run("notify-cache", async () => {
    await notifyShoppingSuggestionsReady(ctx.userId)
  })

  log.info("Workflow completed", { inserted: products.length })
})
