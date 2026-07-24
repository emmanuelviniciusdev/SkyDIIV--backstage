import { z } from "zod"
import type { SearchParams } from "../entities/search-params.js"

/** Canonical name of this consumer event (one of several the broker may carry). */
export const SCRAPE_SHOPPING_SUGGESTIONS_EVENT = "scrape-shopping-suggestions" as const

/** Wire schema for one search (camelCase throughout the payload). */
export const searchParamsSchema = z.object({
  searchTerm: z.string().min(1),
  gender: z.string().nullable(),
  topSize: z.string().nullable(),
  bottomSize: z.string().nullable(),
  footSize: z.string().nullable(),
  brand: z.string().nullable(),
})

export const scrapeShoppingSuggestionsPayloadSchema = z.object({
  marketplace: z.string().min(1),
  userId: z.string().min(1),
  searchParams: z.array(searchParamsSchema).min(1),
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

/** Maps a validated wire search entry to the domain SearchParams type. */
export function toSearchParams(
  value: z.infer<typeof searchParamsSchema>,
): SearchParams {
  return {
    searchTerm: value.searchTerm,
    gender: value.gender,
    topSize: value.topSize,
    bottomSize: value.bottomSize,
    footSize: value.footSize,
    brand: value.brand,
  }
}
