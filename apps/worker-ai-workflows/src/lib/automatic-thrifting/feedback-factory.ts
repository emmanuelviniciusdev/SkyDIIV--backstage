import type { FeedbackAutomaticThriftingRow } from "../db/feedbacks-automatic-thrifting.repository"

export interface EnjoeiFeedbackFactoryRecord {
  marketplace: "enjoei"
  liked: boolean
  reason: string | null
  title: string | null
  price: number | null
  currency: string | null
  size: string | null
  searchTerm: string | null
  gender: string | null
  topSize: string | null
  bottomSize: string | null
  footSize: string | null
}

export type FeedbackFactoryRecord = EnjoeiFeedbackFactoryRecord

export type FeedbackFactory = (row: FeedbackAutomaticThriftingRow) => FeedbackFactoryRecord | null

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

export function resolveFeedbackMarketplace(row: FeedbackAutomaticThriftingRow): string | null {
  const listed = asRecord(row.jsonListedProduct)
  const result = asRecord(row.jsonResult)
  const fromListed = asString(listed?.marketplace)
  const fromResult = asString(result?.marketplace)
  const slug = (fromListed ?? fromResult)?.toLowerCase() ?? null
  return slug
}

export function createEnjoeiFeedbackFactory(): FeedbackFactory {
  return (row) => {
    const listed = asRecord(row.jsonListedProduct)
    const result = asRecord(row.jsonResult)
    const search = asRecord(row.jsonSearch)
    const metadata = asRecord(result?.metadata)

    return {
      marketplace: "enjoei",
      liked: asBoolean(row.liked) ?? false,
      reason: asString(row.reason),
      title: asString(listed?.title) ?? asString(result?.title),
      price: asNumber(listed?.price) ?? asNumber(result?.price),
      currency: asString(listed?.currency) ?? asString(result?.currency),
      size: asString(metadata?.size),
      searchTerm: asString(search?.term) ?? asString(listed?.searchTerm),
      gender: asString(search?.gender),
      topSize: asString(search?.topSize),
      bottomSize: asString(search?.bottomSize),
      footSize: asString(search?.footSize),
    }
  }
}

const FACTORIES: Record<string, FeedbackFactory> = {
  enjoei: createEnjoeiFeedbackFactory(),
}

export function factoryFeedbackRow(
  row: FeedbackAutomaticThriftingRow,
): FeedbackFactoryRecord | null {
  const slug = resolveFeedbackMarketplace(row)
  if (!slug) return null
  const factory = FACTORIES[slug]
  if (!factory) return null
  return factory(row)
}

export function factoryFeedbackRows(
  rows: FeedbackAutomaticThriftingRow[],
): FeedbackFactoryRecord[] {
  const records: FeedbackFactoryRecord[] = []
  for (const row of rows) {
    const record = factoryFeedbackRow(row)
    if (record) records.push(record)
  }
  return records
}

const SNAPSHOT_KEYS = [
  "jsonSearch",
  "jsonResult",
  "jsonListedProduct",
  "json_search",
  "json_result",
  "json_listed_product",
  "url",
  "imageUrl",
  "image_url",
] as const

export function factoryRecordHasSnapshotKeys(record: FeedbackFactoryRecord): boolean {
  const keys = Object.keys(record)
  return SNAPSHOT_KEYS.some((key) => keys.includes(key))
}
