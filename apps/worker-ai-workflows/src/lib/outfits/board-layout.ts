/**
 * Creative-board layout helpers mirrored from the SkyDIIV web app
 * (`lib/outfits/layout-defaults.ts` + `render-board-png.ts` export bounds).
 *
 * Coordinates are in the logical 1600×1600 creative-board canvas space.
 */

export const CREATIVE_BOARD_SIZE = 1600

/** Padding around the pieces bounding box when exporting a thumbnail (board units). */
export const BOARD_EXPORT_PADDING = 32

const DEFAULT_PIECE_SIZE = 360

export interface BoardLayoutItem {
  clothingItemId: string
  posX: number
  posY: number
  width: number
  height: number
  zIndex: number
  /** Degrees, clockwise. Weekly defaults always use 0. */
  rotation: number
}

export type BoardExportBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

/**
 * Spreads pieces in a simple grid on the creative board canvas.
 * Must stay in sync with `buildDefaultBoardLayout` in the web app.
 */
export function buildDefaultBoardLayout(pieceIds: string[]): BoardLayoutItem[] {
  const count = pieceIds.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const cell = Math.min(DEFAULT_PIECE_SIZE, Math.floor(CREATIVE_BOARD_SIZE / (cols + 0.5)))
  const gap = Math.floor(cell * 0.12)
  const size = cell - gap

  return pieceIds.map((clothingItemId, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const totalWidth = cols * size + (cols - 1) * gap
    const rows = Math.ceil(count / cols)
    const totalHeight = rows * size + (rows - 1) * gap
    const originX = Math.max(0, (CREATIVE_BOARD_SIZE - totalWidth) / 2)
    const originY = Math.max(0, (CREATIVE_BOARD_SIZE - totalHeight) / 2)

    return {
      clothingItemId,
      posX: originX + col * (size + gap),
      posY: originY + row * (size + gap),
      width: size,
      height: size,
      zIndex: index,
      rotation: 0,
    }
  })
}

/**
 * Computes a padded axis-aligned bounding box around all board pieces,
 * clamped to the logical creative board. Rotation is ignored (weekly defaults
 * always use rotation 0).
 */
export function computeBoardExportBounds(
  items: Array<Pick<BoardLayoutItem, "posX" | "posY" | "width" | "height">>,
  padding = BOARD_EXPORT_PADDING,
): BoardExportBounds {
  if (items.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: CREATIVE_BOARD_SIZE,
      maxY: CREATIVE_BOARD_SIZE,
      width: CREATIVE_BOARD_SIZE,
      height: CREATIVE_BOARD_SIZE,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const item of items) {
    minX = Math.min(minX, item.posX)
    minY = Math.min(minY, item.posY)
    maxX = Math.max(maxX, item.posX + item.width)
    maxY = Math.max(maxY, item.posY + item.height)
  }

  minX = Math.max(0, Math.floor(minX - padding))
  minY = Math.max(0, Math.floor(minY - padding))
  maxX = Math.min(CREATIVE_BOARD_SIZE, Math.ceil(maxX + padding))
  maxY = Math.min(CREATIVE_BOARD_SIZE, Math.ceil(maxY + padding))

  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  return { minX, minY, maxX, maxY, width, height }
}

/**
 * Scale factor so the longest side of `bounds` is at most `maxSide` pixels.
 * Never upscales (scale ≤ 1).
 */
export function boardThumbnailScale(bounds: BoardExportBounds, maxSide: number): number {
  const longest = Math.max(bounds.width, bounds.height)
  if (longest <= 0) return 1
  return Math.min(1, maxSide / longest)
}
