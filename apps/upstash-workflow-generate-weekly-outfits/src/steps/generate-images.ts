import { getReadDb, getWriteDb } from "../lib/db/client"
import { SqlWeeklyOutfitsRepository } from "../lib/db/weekly-outfits.repository"
import { compositeImages } from "../lib/image/composite"
import { uploadImageToR2 } from "../lib/storage/r2-client"
import { createLogger } from "../lib/logger"
import type { Logger } from "../lib/logger"
import type { SavedOutfitRef } from "../lib/db/weekly-outfits.repository"

export interface GenerateImageInput {
  userId: string
  /** Single outfit to generate a composite image for. */
  outfit: SavedOutfitRef
  /** clothing_item_id → public image URL (only for pieces that have images). */
  wardrobeImageMap: Record<string, string>
}

/**
 * Step 4 — Generates a composite collage image for a single saved outfit and
 * updates its `image_url` in the database.
 *
 *   1. Collect the public image URLs for the outfit's clothing pieces.
 *   2. Fetch each image buffer.
 *   3. Composite them into a 1600×1600 JPEG grid (same algorithm as
 *      skydiiv's `/api/outfits/composite.ts` which uses Sharp).
 *   4. Upload the result to Cloudflare R2.
 *   5. UPDATE outfits.image_url for the corresponding outfit row.
 *
 * Returns true if the image was generated, false if skipped (no images
 * available). Throws on unexpected errors so the caller (workflow step) can
 * decide whether to retry or swallow the failure.
 *
 * Called once per outfit so that each invocation runs in its own Cloudflare
 * Worker request, keeping CPU usage well within the per-request time limit.
 */
export async function generateImageStep(input: GenerateImageInput): Promise<boolean> {
  const { outfit, wardrobeImageMap, userId } = input
  const log = createLogger("generate-images", userId)

  const repo = new SqlWeeklyOutfitsRepository(getReadDb(), getWriteDb())

  const imageUrls = outfit.clothingPieceIds
    .map((id) => wardrobeImageMap[id])
    .filter((url): url is string => Boolean(url))

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

  const imageBuffers = await fetchImages(imageUrls, log)

  if (imageBuffers.length === 0) {
    log.warn("All image fetches failed — skipping composite", {
      outfitId: outfit.outfitId,
    })
    return false
  }

  const composited = compositeImages(imageBuffers)

  const key = `outfits/${outfit.outfitId}.jpg`
  const imageUrl = await uploadImageToR2(composited, key)

  await repo.updateOutfitImageUrl(outfit.outfitId, imageUrl)

  log.info("Image generated and saved", {
    outfitId: outfit.outfitId,
    weekday: outfit.weekday,
    key,
    pieceImages: imageBuffers.length,
  })

  return true
}

// ---------------------------------------------------------------------------

/**
 * Fetches all image URLs concurrently, resolving fulfilled results only.
 * Individual URL failures are logged as warnings and silently dropped.
 */
async function fetchImages(urls: string[], log: Logger): Promise<Buffer[]> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching image: ${url}`)
      return Buffer.from(await res.arrayBuffer())
    }),
  )

  const buffers: Buffer[] = []
  for (const result of results) {
    if (result.status === "fulfilled") {
      buffers.push(result.value)
    } else {
      log.warn("Failed to fetch piece image", {
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }
  return buffers
}
