import { getWriteDb } from "../../../lib/db/client"
import { SqlOutboxEventsRepository } from "../../../lib/db/outbox-events.repository"
import type { ShoppingSuggestionsPreferences } from "../../../lib/db/shopping-suggestions-preferences.repository"
import { batchPublishOutboxMessages } from "../../../lib/outbox/publish"
import type { ParsedShoppingSuggestion } from "../../../lib/prompt/panorama-response"
import { composeSearchParams } from "../../../lib/shopping/compose-search-params"
import { createLogger } from "../../../lib/logger"

const MARKETPLACE = "enjoei"

export interface EnqueueShoppingSuggestionsInput {
  userId: string
  suggestions: ParsedShoppingSuggestion[]
  shoppingPreferences: ShoppingSuggestionsPreferences | null
}

export interface EnqueueShoppingSuggestionsResult {
  enqueued: boolean
  outboxEventId?: string
  searchParamCount: number
}

/**
 * Composes scrape search params, inserts a PENDING outbox row, and triggers
 * worker-outbox-events via QStash batchJSON.
 *
 * Insert failures are fatal. QStash failures after a successful insert are
 * non-fatal (catch-up will reprocess PENDING rows).
 */
export async function enqueueShoppingSuggestionsStep(
  input: EnqueueShoppingSuggestionsInput,
): Promise<EnqueueShoppingSuggestionsResult> {
  const log = createLogger("enqueue-shopping-suggestions", input.userId)

  if (input.suggestions.length === 0) {
    log.info("No shopping suggestions to enqueue — skipping")
    return { enqueued: false, searchParamCount: 0 }
  }

  const searchParams = composeSearchParams(input.suggestions, input.shoppingPreferences)
  log.info("Composed search params", {
    searchParamCount: searchParams.length,
    hasShoppingPreferences: input.shoppingPreferences !== null,
  })

  const repo = new SqlOutboxEventsRepository(getWriteDb())
  const outboxEventId = await repo.insertScrapeShoppingSuggestions({
    marketplace: MARKETPLACE,
    userId: input.userId,
    searchParams,
  })
  log.info("Outbox event inserted", { outboxEventId })

  try {
    await batchPublishOutboxMessages([outboxEventId])
    log.info("Outbox event published to QStash", { outboxEventId })
  } catch (err) {
    log.warn("Failed to publish outbox event to QStash — catch-up will retry", {
      outboxEventId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return {
    enqueued: true,
    outboxEventId,
    searchParamCount: searchParams.length,
  }
}
