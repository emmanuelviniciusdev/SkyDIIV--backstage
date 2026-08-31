import { serveMany } from "@upstash/workflow/cloudflare"
import { resolveWorkflowBaseUrl } from "../lib/workflow-base-url"
import { generateWeeklyOutfitsWorkflow } from "./generate-weekly-outfits/workflow"
import { generateWardrobePanoramaWorkflow } from "./generate-wardrobe-panorama/workflow"
import { generateSearchTermsProductsScrapingWorkflow } from "./generate-search-terms-products-scraping/workflow"
import { analyzeScrapedProductsResultsWorkflow } from "./analyze-scraped-products-results/workflow"

/**
 * Workflow registry for the worker-ai-workflows worker.
 *
 * `serveMany` hosts multiple Upstash Workflows on a single Cloudflare Worker and
 * routes each request by the LAST path segment of its URL. The map key becomes
 * the public endpoint and is preserved across QStash step callbacks:
 *
 *   key "generate-weekly-outfits"  →  POST /generate-weekly-outfits
 *
 * Callback base URL comes from WORKER_AI_WORKFLOWS_URL (passed as serveMany `baseUrl`).
 *
 * Note: workflow keys cannot contain "/".
 */
export const workflowRegistry = {
  "generate-weekly-outfits": generateWeeklyOutfitsWorkflow,
  "generate-wardrobe-panorama": generateWardrobePanoramaWorkflow,
  "generate-search-terms-products-scraping": generateSearchTermsProductsScrapingWorkflow,
  "analyze-scraped-products-results": analyzeScrapedProductsResultsWorkflow,
} as const

let cachedBaseUrl: string | undefined
let cachedFetch: ReturnType<typeof serveMany>["fetch"] | undefined

/**
 * Dispatches a request to the matching workflow. `serveMany` types its handler
 * as `Promise<any>`; we narrow it to `Promise<Response>` for the caller.
 */
export function workflowsFetch(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const baseUrl = resolveWorkflowBaseUrl(env)

  if (cachedBaseUrl !== baseUrl || !cachedFetch) {
    cachedBaseUrl = baseUrl
    cachedFetch = serveMany(workflowRegistry, { baseUrl }).fetch
  }

  return cachedFetch(request, env) as Promise<Response>
}
