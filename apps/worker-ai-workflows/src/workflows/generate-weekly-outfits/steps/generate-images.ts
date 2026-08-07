import { getReadDb, getWriteDb } from "../../../lib/db/client"
import { SqlWeeklyOutfitsRepository } from "../../../lib/db/weekly-outfits.repository"
import { uploadImageToR2 } from "../../../lib/storage/r2-client"
import { getImages } from "../../../lib/cf-images"
import { createLogger } from "../../../lib/logger"
import type { Logger } from "../../../lib/logger"
import type { SavedOutfitRef } from "../../../lib/db/weekly-outfits.repository"
import {
  boardThumbnailScale,
  computeBoardExportBounds,
  type BoardLayoutItem,
} from "../../../lib/outfits/board-layout"

/** Longest side of the exported thumbnail in pixels. */
const THUMBNAIL_MAX_SIDE = 800

/**
 * Number of overlays drawn per Cloudflare Images pipeline execution.
 * Each overlay adds a child .input() + .transform() (~2 operations) and CF caps
 * a single pipeline tree at 10 operations, so 3 draws (~7 ops) stays safely
 * under the limit. Larger outfits are composited across multiple batches.
 */
const DRAWS_PER_BATCH = 3

/**
 * Minimal 1×1 fully-transparent RGBA PNG (R=G=B=A=0).
 * Do not substitute the common "tracking pixel" 1×1s — many are opaque red/pink
 * and become a solid pink canvas when CF Images stretches them to thumbnail size.
 */
const TRANSPARENT_PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
)

export interface GenerateImageInput {
  userId: string
  /** Single outfit to generate a composite image for (includes board layout). */
  outfit: SavedOutfitRef
  /** clothing_item_id → public image URL (only for pieces that have images). */
  wardrobeImageMap: Record<string, string>
}

interface DrawCell {
  streamIndex: number
  top: number
  left: number
  width: number
  height: number
}

/**
 * Step 4 — Generates a composite collage thumbnail for a single saved outfit
 * using the Cloudflare Images binding (env.IMAGES), placing pieces at their
 * creative-board layout positions (scaled to a padded export crop), then
 * updates `outfits.image_url` in the database.
 *
 * Flow:
 *   1. Resolve piece image URLs from wardrobeImageMap (layout order / zIndex).
 *   2. Fetch each image; skip if all fetches fail.
 *   3. Compute export bounds from layout → scale so longest side ≤ 800px.
 *   4. CF Images: transparent canvas → draw pieces at scaled board positions.
 *   5. Upload the resulting PNG to R2.
 *   6. UPDATE outfits.image_url in the DB.
 *
 * Returns true if an image was generated, false if skipped (no piece images
 * available or all fetches failed). Throws on unexpected errors so the
 * Upstash Workflow step can retry if needed.
 */
export async function generateImageStep(input: GenerateImageInput): Promise<boolean> {
  const { outfit, wardrobeImageMap, userId } = input
  const log = createLogger("generate-images", userId)

  const repo = new SqlWeeklyOutfitsRepository(getReadDb(), getWriteDb())

  // Keep layout order (zIndex ascending) but only pieces that have images.
  const piecesWithImages: Array<BoardLayoutItem & { imageUrl: string }> = []
  for (const item of outfit.layout.slice().sort((a, b) => a.zIndex - b.zIndex)) {
    const imageUrl = wardrobeImageMap[item.clothingItemId]
    if (imageUrl) piecesWithImages.push({ ...item, imageUrl })
  }

  if (piecesWithImages.length === 0) {
    log.warn("No images available for outfit — skipping composite", {
      outfitId: outfit.outfitId,
      weekday: outfit.weekday,
    })
    return false
  }

  const imageUrls = piecesWithImages.map((item) => item.imageUrl)

  log.debug("Fetching piece images", {
    outfitId: outfit.outfitId,
    weekday: outfit.weekday,
    imageCount: imageUrls.length,
  })

  const { streams, layoutItems } = await fetchPieceImages(imageUrls, piecesWithImages, log)

  if (streams.length === 0) {
    log.warn("All image fetches failed — skipping composite", { outfitId: outfit.outfitId })
    return false
  }

  const composited = await buildBoardComposite(layoutItems, streams, log)

  const key = `outfits/${outfit.outfitId}.png`
  const imageUrl = await uploadImageToR2(composited, key, { userid: userId }, "image/png")

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
 * Fetches piece image URLs concurrently. Returns only streams + matching layout
 * items that succeeded; failed fetches are logged and dropped.
 */
async function fetchPieceImages(
  urls: string[],
  layoutItems: BoardLayoutItem[],
  log: Logger,
): Promise<{ streams: ReadableStream[]; layoutItems: BoardLayoutItem[] }> {
  const results = await Promise.allSettled(
    urls.map(async (url, index) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching image: ${url}`)
      if (!res.body) throw new Error(`Empty body fetching image: ${url}`)
      return { index, stream: res.body }
    }),
  )

  const streams: ReadableStream[] = []
  const keptLayout: BoardLayoutItem[] = []

  for (const result of results) {
    if (result.status === "fulfilled") {
      const layoutItem = layoutItems[result.value.index]
      if (!layoutItem) continue
      streams.push(result.value.stream)
      keptLayout.push(layoutItem)
    } else {
      log.warn("Failed to fetch piece image", {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  return { streams, layoutItems: keptLayout }
}

/**
 * Builds a transparent PNG composite using creative-board positions.
 * Cloudflare's backend performs all pixel operations — the Worker spends no CPU.
 */
async function buildBoardComposite(
  layoutItems: BoardLayoutItem[],
  streams: ReadableStream[],
  log: Logger,
): Promise<Buffer> {
  const images = getImages()
  const bounds = computeBoardExportBounds(layoutItems)
  const scale = boardThumbnailScale(bounds, THUMBNAIL_MAX_SIDE)
  const canvasWidth = Math.max(1, Math.round(bounds.width * scale))
  const canvasHeight = Math.max(1, Math.round(bounds.height * scale))

  const cells: DrawCell[] = layoutItems.map((item, streamIndex) => ({
    streamIndex,
    left: Math.round((item.posX - bounds.minX) * scale),
    top: Math.round((item.posY - bounds.minY) * scale),
    width: Math.max(1, Math.round(item.width * scale)),
    height: Math.max(1, Math.round(item.height * scale)),
  }))

  // Stretch a transparent pixel to the canvas size — avoids pad/background
  // colour parsing and keeps the composite alpha channel intact.
  let canvas: ArrayBuffer = await (
    await images
      .input(TRANSPARENT_PNG_1X1.buffer.slice(
        TRANSPARENT_PNG_1X1.byteOffset,
        TRANSPARENT_PNG_1X1.byteOffset + TRANSPARENT_PNG_1X1.byteLength,
      ))
      .transform({
        width: canvasWidth,
        height: canvasHeight,
        fit: "squeeze",
      })
      .output({ format: "image/png" })
  ).response().arrayBuffer()

  for (let i = 0; i < cells.length; i += DRAWS_PER_BATCH) {
    const batch = cells.slice(i, i + DRAWS_PER_BATCH)

    let pipeline = images.input(canvas)
    for (const cell of batch) {
      const stream = streams[cell.streamIndex]
      if (!stream) continue
      // Pad (not cover) so the full piece stays visible inside its layout cell;
      // transparent letterboxing lets pieces overlap neighbours without cropping.
      pipeline = pipeline.draw(
        images.input(stream).transform({
          width: cell.width,
          height: cell.height,
          fit: "pad",
          background: "rgba(0,0,0,0)",
        }),
        {
          top: cell.top,
          left: cell.left,
          width: cell.width,
          height: cell.height,
        },
      )
    }

    canvas = await (
      await pipeline.output({ format: "image/png" })
    ).response().arrayBuffer()
  }

  const buffer = Buffer.from(canvas)

  log.debug("CF Images board composite built", {
    cells: cells.length,
    batches: Math.ceil(cells.length / DRAWS_PER_BATCH),
    canvasWidth,
    canvasHeight,
    scale,
    bytes: buffer.byteLength,
  })

  return buffer
}
