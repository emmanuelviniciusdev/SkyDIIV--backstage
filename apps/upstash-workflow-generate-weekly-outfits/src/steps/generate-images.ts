import { getReadDb, getWriteDb } from "../lib/db/client"
import { SqlWeeklyOutfitsRepository } from "../lib/db/weekly-outfits.repository"
import { compositeImages } from "../lib/image/composite"
import { uploadImageToR2 } from "../lib/storage/r2-client"
import { createLogger } from "../lib/logger"
import type { Logger } from "../lib/logger"
import type { SavedOutfitRef } from "../lib/db/weekly-outfits.repository"

export interface GenerateImagesInput {
  userId: string
  /** Outfits that were saved in step 3, with their DB IDs and piece IDs. */
  savedOutfits: SavedOutfitRef[]
  /** clothing_item_id → public image URL (only for pieces that have images). */
  wardrobeImageMap: Record<string, string>
}

/**
 * Step 4 — Generates a composite collage image for each saved outfit and
 * updates its `image_url` in the database.
 *
 *   1. Collect the public image URLs for the outfit's clothing pieces.
 *   2. Fetch each image buffer.
 *   3. Composite them into a 1600×1600 JPEG grid (same algorithm as
 *      skydiiv's `/api/outfits/composite.ts` which uses Sharp).
 *   4. Upload the result to Cloudflare R2.
 *   5. UPDATE outfits.image_url for the corresponding outfit row.
 *
 * Failures are caught per-outfit and logged as warnings so that a single
 * broken piece image never crashes the whole workflow — outfits are always
 * saved with their clothing items regardless of image generation success.
 */
export async function generateImagesStep(input: GenerateImagesInput): Promise<void> {
  const log = createLogger("generate-images", input.userId)
  log.info("Step started", { outfitCount: input.savedOutfits.length })

  const repo = new SqlWeeklyOutfitsRepository(getReadDb(), getWriteDb())

  let generatedCount = 0

  for (const outfit of input.savedOutfits) {
    try {
      const imageUrls = outfit.clothingPieceIds
        .map((id) => input.wardrobeImageMap[id])
        .filter((url): url is string => Boolean(url))

      if (imageUrls.length === 0) {
        log.warn("No images available for outfit — skipping composite", {
          outfitId: outfit.outfitId,
          weekday: outfit.weekday,
        })
        continue
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
        continue
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
      generatedCount++
    } catch (err) {
      // Never crash the workflow — image generation is best-effort.
      log.warn("Failed to generate image for outfit — continuing", {
        outfitId: outfit.outfitId,
        weekday: outfit.weekday,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  log.info("Step completed", {
    outfitCount: input.savedOutfits.length,
    generatedCount,
    skippedCount: input.savedOutfits.length - generatedCount,
  })
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
