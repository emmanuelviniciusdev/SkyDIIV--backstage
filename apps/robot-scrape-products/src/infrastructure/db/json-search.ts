export interface JsonSearch {
  term: string
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
}

/** Nested JSON for `json_result.metadata` (index signature required by postgres.js `JSONValue`). */
export type JsonResultMetadata = {
  readonly [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | JsonResultMetadata
    | readonly (string | number | boolean | null | JsonResultMetadata)[]
}

/** Listing persisted in `results_search_terms_scraped_products.json_result`. */
export type JsonResult = {
  marketplace: string
  title: string
  price: number
  currency: string
  url: string
  image_url: string
  metadata: JsonResultMetadata
}

export const PLACEHOLDER_IMAGE_URL =
  "https://assets.skydiiv.space/placeholder--scraped-product.png"

export const MAX_RESULTS_PER_TERM = 10
