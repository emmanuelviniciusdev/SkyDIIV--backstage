import { getReadDb, getWriteDb } from "../lib/db/client"
import { SqlWeeklyOutfitsRepository } from "../lib/db/weekly-outfits.repository"
import { uploadImageToR2 } from "../lib/storage/r2-client"
import { getImages } from "../lib/cf-images"
import { createLogger } from "../lib/logger"
import type { Logger } from "../lib/logger"
import type { SavedOutfitRef } from "../lib/db/weekly-outfits.repository"

// Thumbnail canvas size in pixels. Both dimensions use this value.
const CANVAS_SIZE = 400

// Number of overlays drawn per Cloudflare Images pipeline execution.
// Each overlay adds a child .input() + .transform() (~2 operations) and CF caps
// a single pipeline tree at 10 operations, so 3 draws (~7 ops) stays safely
// under the limit. Larger outfits are composited across multiple batches.
const DRAWS_PER_BATCH = 3

// Visual cap on how many pieces appear in a thumbnail. A 400×400 grid becomes
// unreadable beyond this, and it also bounds the number of pipeline executions
// (and therefore billable transformations) per outfit. Not a hard API limit —
// the batching above can handle any count — purely a quality/cost guard.
const MAX_PIECES_IN_COMPOSITE = 12

export interface GenerateImageInput {
  userId: string
  /** Single outfit to generate a composite image for. */
  outfit: SavedOutfitRef
  /** clothing_item_id → public image URL (only for pieces that have images). */
  wardrobeImageMap: Record<string, string>
}

/**
 * Step 4 — Generates a composite collage thumbnail for a single saved outfit
 * using the Cloudflare Images binding (env.IMAGES) and updates its
 * `image_url` in the database.
 *
 * Flow:
 *   1. Resolve piece image URLs from wardrobeImageMap.
 *   2. Fetch each image; skip if all fetches fail.
 *   3. Build a CF Images pipeline: base image → grid overlays via .draw().
 *      All pixel work is offloaded to Cloudflare's backend — zero Worker CPU.
 *   4. Upload the resulting JPEG to R2.
 *   5. UPDATE outfits.image_url in the DB.
 *
 * Returns true if an image was generated, false if skipped (no piece images
 * available or all fetches failed). Throws on unexpected errors so the
 * Upstash Workflow step can retry if needed.
 *
 * Called once per outfit via a dedicated workflow step so that even a single
 * outfit's CF Images call gets its own Worker invocation.
 */
export async function generateImageStep(input: GenerateImageInput): Promise<boolean> {
  const { outfit, wardrobeImageMap, userId } = input
  const log = createLogger("generate-images", userId)

  const repo = new SqlWeeklyOutfitsRepository(getReadDb(), getWriteDb())

  const imageUrls = outfit.clothingPieceIds
    .map((id) => wardrobeImageMap[id])
    .filter((url): url is string => Boolean(url))
    .slice(0, MAX_PIECES_IN_COMPOSITE)

  if (imageUrls.length === 0) {
    log.warn("No images available for outfit — skipping composite", {
      outfitId: outfit.outfitId,
      weekday: outfit.weekday,
    })
    return false
  }

  log.debug("Fetching piece images", {
    outfitId: outfit.outfitId,
    weekday: outfit.weekday,
    imageCount: imageUrls.length,
  })

  const { validUrls, streams } = await fetchPieceImages(imageUrls, log)

  if (streams.length === 0) {
    log.warn("All image fetches failed — skipping composite", { outfitId: outfit.outfitId })
    return false
  }

  const composited = await buildComposite(validUrls, streams, log)

  const key = `outfits/${outfit.outfitId}.jpg`
  const imageUrl = await uploadImageToR2(composited, key)

  await repo.updateOutfitImageUrl(outfit.outfitId, imageUrl)

  log.info("Image generated and saved", {
    outfitId: outfit.outfitId,
    weekday: outfit.weekday,
    key,
    pieceImages: streams.length,
  })

  return true
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Distributes `total` pixels across `count` slots, adding 1 extra pixel to
 * the first `remainder` slots so the sum always equals `total`.
 */
function allocateSizes(count: number, total: number): number[] {
  const base = Math.floor(total / count)
  const remainder = total - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

interface GridCell {
  urlIndex: number
  top: number
  left: number
  width: number
  height: number
}

/**
 * Calculates the grid cell layout for `n` pieces on a CANVAS_SIZE×CANVAS_SIZE
 * canvas, mirroring the layout used in skydiiv's composite.ts:
 *   - columns = ceil(sqrt(n)), rows = ceil(n / cols)
 *   - last row spreads remaining images evenly
 */
function buildGridCells(n: number): GridCell[] {
  const baseCols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / baseCols)
  const rowHeights = allocateSizes(rows, CANVAS_SIZE)

  const cells: GridCell[] = []
  let idx = 0
  let top = 0

  for (let row = 0; row < rows; row++) {
    const remaining = n - row * baseCols
    const colsThisRow = row === rows - 1 ? Math.max(1, Math.min(baseCols, remaining)) : baseCols
    const colWidths = allocateSizes(colsThisRow, CANVAS_SIZE)
    const cellHeight = rowHeights[row]
    let left = 0

    for (let col = 0; col < colsThisRow && idx < n; col++) {
      cells.push({ urlIndex: idx, top, left, width: colWidths[col], height: cellHeight })
      left += colWidths[col]
      idx++
    }
    top += rowHeights[row]
  }

  return cells
}

/**
 * Fetches all piece image URLs concurrently.
 * Returns only the URLs + streams that succeeded; failed fetches are logged
 * as warnings and dropped so a single broken URL never aborts the composite.
 */
async function fetchPieceImages(
  urls: string[],
  log: Logger,
): Promise<{ validUrls: string[]; streams: ReadableStream[] }> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching image: ${url}`)
      return { url, stream: res.body! }
    }),
  )

  const validUrls: string[] = []
  const streams: ReadableStream[] = []

  for (const result of results) {
    if (result.status === "fulfilled") {
      validUrls.push(result.value.url)
      streams.push(result.value.stream)
    } else {
      log.warn("Failed to fetch piece image", {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  return { validUrls, streams }
}

/**
 * Builds a CANVAS_SIZE×CANVAS_SIZE JPEG composite using the Cloudflare Images
 * binding. Each piece stream is drawn at its calculated grid cell position.
 * Cloudflare's backend performs all pixel operations — the Worker spends no CPU.
 *
 * Cloudflare flattens an entire `.input()/.transform()/.draw()` chain into a
 * single operation tree and caps it at 10 operations. Every overlay adds a
 * child `.input()` + `.transform()`, so a single pipeline overflows after only
 * a few pieces. To support any number of pieces we draw them in small batches:
 * each batch is its own pipeline execution whose JPEG output becomes the canvas
 * input for the next batch. This keeps every pipeline well under the limit.
 *
 * The first piece is scaled to fill the canvas as the initial background; it is
 * then fully covered by the grid-cell overlays (including its own cell).
 */
async function buildComposite(
  validUrls: string[],
  streams: ReadableStream[],
  log: Logger,
): Promise<Buffer> {
  const images = getImages()
  const cells = buildGridCells(streams.length)

  // The initial background establishes the canvas dimensions. We re-fetch
  // piece[0] for it so its original stream stays available for its own cell.
  const baseRes = await fetch(validUrls[0])
  if (!baseRes.ok) throw new Error(`Failed to re-fetch base image: ${validUrls[0]}`)

  let canvas: ArrayBuffer = await (
    await images
      .input(baseRes.body!)
      .transform({ width: CANVAS_SIZE, height: CANVAS_SIZE, fit: "cover" })
      .output({ format: "image/jpeg", quality: 85 })
  ).response().arrayBuffer()

  // Each overlay costs ~2 operations (child input + transform), so a batch of
  // DRAWS_PER_BATCH=3 keeps a pipeline at ~7 operations — safely under the cap.
  for (let i = 0; i < cells.length; i += DRAWS_PER_BATCH) {
    const batch = cells.slice(i, i + DRAWS_PER_BATCH)

    let pipeline = images.input(canvas)
    for (const cell of batch) {
      pipeline = pipeline.draw(
        images.input(streams[cell.urlIndex]).transform({ width: cell.width, height: cell.height, fit: "cover" }),
        { top: cell.top, left: cell.left },
      )
    }

    canvas = await (
      await pipeline.output({ format: "image/jpeg", quality: 85 })
    ).response().arrayBuffer()
  }

  const buffer = Buffer.from(canvas)

  log.debug("CF Images composite built", {
    cells: cells.length,
    batches: Math.ceil(cells.length / DRAWS_PER_BATCH),
    bytes: buffer.byteLength,
  })

  return buffer
}
