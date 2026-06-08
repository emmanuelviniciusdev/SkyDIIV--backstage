// @cf-wasm/photon auto-selects the right WASM implementation:
//   - Cloudflare Workers → "workerd" export condition
//   - Node.js (tests)    → "node" export condition
// It also natively supports JPEG, PNG, and WebP decoding/encoding,
// which covers the WebP piece images stored in Cloudflare R2.
import { PhotonImage, SamplingFilter, crop, resize, watermark } from "@cf-wasm/photon"

// 400×400 keeps CPU usage well within Cloudflare Workers limits.
// The full-resolution composite (1600×1600) lives in the main app via Sharp.
const CANVAS_SIZE = 400

/**
 * Distributes `total` pixels across `count` slots, adding 1 extra pixel to
 * the first `remainder` slots so the sum always equals `total`.
 */
function allocateSizes(count: number, total: number): number[] {
  const base = Math.floor(total / count)
  const remainder = total - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Resizes a PhotonImage to exactly (targetW × targetH) using cover semantics:
 * scale up/down so the image fills the target dimensions, then centre-crop.
 * Returns a new PhotonImage; the caller must free the original if no longer needed.
 */
function coverResize(img: PhotonImage, targetW: number, targetH: number): PhotonImage {
  const srcW = img.get_width()
  const srcH = img.get_height()

  const scale = Math.max(targetW / srcW, targetH / srcH)
  const scaledW = Math.max(targetW, Math.round(srcW * scale))
  const scaledH = Math.max(targetH, Math.round(srcH * scale))

  // Triangle (bilinear) is 3-4× faster than CatmullRom with acceptable quality for thumbnails.
  const scaled = resize(img, scaledW, scaledH, SamplingFilter.Triangle)

  if (scaledW === targetW && scaledH === targetH) return scaled

  const x1 = Math.floor((scaledW - targetW) / 2)
  const y1 = Math.floor((scaledH - targetH) / 2)
  const cropped = crop(scaled, x1, y1, x1 + targetW, y1 + targetH)
  scaled.free()
  return cropped
}

/**
 * Composites multiple image buffers (JPEG, PNG, or WebP) into a single JPEG
 * grid collage.
 *
 * Layout mirrors skydiiv's `/api/outfits/composite.ts` (Sharp implementation):
 * - canvas is always 1600×1600 px
 * - columns = ceil(sqrt(n)); rows = ceil(n / cols)
 * - last row gets only the remaining images, spread evenly across the canvas
 *
 * Piece images are resized with "cover" (fill + centre-crop) so no letterboxing.
 */
export function compositeImages(imageBuffers: Buffer[]): Buffer {
  if (imageBuffers.length === 0) throw new Error("No images provided")

  const baseCols = Math.max(1, Math.ceil(Math.sqrt(imageBuffers.length)))
  const rows = Math.ceil(imageBuffers.length / baseCols)
  const rowHeights = allocateSizes(rows, CANVAS_SIZE)

  // Create 1600×1600 white RGBA canvas
  const whitePixels = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE * 4).fill(255)
  const canvas = new PhotonImage(whitePixels, CANVAS_SIZE, CANVAS_SIZE)

  let imageIndex = 0
  let top = 0

  for (let row = 0; row < rows; row++) {
    const remaining = imageBuffers.length - row * baseCols
    const colsThisRow =
      row === rows - 1 ? Math.max(1, Math.min(baseCols, remaining)) : baseCols
    const colWidths = allocateSizes(colsThisRow, CANVAS_SIZE)
    const cellHeight = rowHeights[row]

    let left = 0
    for (let col = 0; col < colsThisRow && imageIndex < imageBuffers.length; col++) {
      const cellWidth = colWidths[col]
      const src = PhotonImage.new_from_byteslice(new Uint8Array(imageBuffers[imageIndex]))
      const cell = coverResize(src, cellWidth, cellHeight)
      src.free()
      watermark(canvas, cell, BigInt(left), BigInt(top))
      cell.free()
      left += cellWidth
      imageIndex++
    }

    top += rowHeights[row]
  }

  const jpegBytes = canvas.get_bytes_jpeg(85)
  canvas.free()

  return Buffer.from(jpegBytes)
}
