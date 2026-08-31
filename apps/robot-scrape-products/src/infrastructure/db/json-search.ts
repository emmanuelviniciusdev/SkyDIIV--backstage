export interface JsonSearch {
  term: string
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
}

export interface JsonResult {
  marketplace: string
  title: string
  price: number
  currency: string
  url: string
  image_url: string
  metadata: Record<string, unknown>
}

export const PLACEHOLDER_IMAGE_URL =
  "https://assets.skydiiv.space/placeholder--scraped-product.png"

export const MAX_RESULTS_PER_TERM = 10
