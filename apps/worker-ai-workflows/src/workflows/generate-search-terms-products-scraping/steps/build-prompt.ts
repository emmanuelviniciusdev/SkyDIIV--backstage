import { buildGenerateSearchTermsPrompt } from "../../../lib/i18n/prompts/generate-search-terms"
import type { LoadGenerateSearchTermsContextResult } from "./load-context"

export function buildGenerateSearchTermsPromptStep(
  ctx: LoadGenerateSearchTermsContextResult,
): string {
  return buildGenerateSearchTermsPrompt({
    locale: ctx.locale,
    panoramaContent: ctx.panoramaContent,
    routineDescription: ctx.routineDescription,
    gender: ctx.shoppingPreferences?.gender ?? null,
    topSize: ctx.shoppingPreferences?.topSize ?? null,
    bottomSize: ctx.shoppingPreferences?.bottomSize ?? null,
    footSize: ctx.shoppingPreferences?.footSize ?? null,
    eligibleMarketplaces: ctx.eligibleMarketplaces.map((m) => m.name),
  })
}
