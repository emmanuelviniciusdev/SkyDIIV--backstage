import { z } from "zod"

/** Canonical name of the Redis Stream event handled by this consumer. */
export const SCRAPE_SHOPPING_SUGGESTIONS_EVENT = "scrape-shopping-suggestions" as const

export const scrapeShoppingSuggestionsPayloadSchema = z.object({
  marketplace: z.string().min(1),
  userid: z.string().min(1),
  search_terms: z.array(z.string().min(1)).min(1),
})

export type ScrapeShoppingSuggestionsPayload = z.infer<
  typeof scrapeShoppingSuggestionsPayloadSchema
>

export interface ScrapeShoppingSuggestionsEvent {
  name: typeof SCRAPE_SHOPPING_SUGGESTIONS_EVENT
  payload: ScrapeShoppingSuggestionsPayload
}

export const streamMessageSchema = z.object({
  event: z.literal(SCRAPE_SHOPPING_SUGGESTIONS_EVENT),
  payload: scrapeShoppingSuggestionsPayloadSchema,
})

export type StreamMessage = z.infer<typeof streamMessageSchema>
