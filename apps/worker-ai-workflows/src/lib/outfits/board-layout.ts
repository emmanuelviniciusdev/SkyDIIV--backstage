/**
 * Creative-board layout helpers for weekly AI outfits.
 *
 * Coordinates are in the logical 1600×1600 creative-board canvas space.
 * Placement is a flat-lay outfit collage (body map by piece type), not a grid.
 */

export const CREATIVE_BOARD_SIZE = 1600

/** Padding around the pieces bounding box when exporting a thumbnail (board units). */
export const BOARD_EXPORT_PADDING = 32

export interface BoardLayoutItem {
  clothingItemId: string
  posX: number
  posY: number
  width: number
  height: number
  zIndex: number
  /**
   * Always 0. Weekly outfit thumbnails are composited via CF Images, which
   * does not apply rotation — storing non-zero values would diverge from the
   * PNG and from what the creative board would show.
   */
  rotation: number
}

export type BoardPieceInput = {
  id: string
  pieceType?: string | null
}

export type BoardExportBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

type PieceRole = "outerwear" | "dress" | "top" | "bottom" | "footwear" | "accessory" | "other"

type Slot = {
  cx: number
  cy: number
  width: number
  height: number
  zIndex: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function resolveRole(pieceType: string | null | undefined): PieceRole {
  const t = (pieceType ?? "").trim().toLowerCase()
  if (!t) return "other"
  if (t.includes("outer")) return "outerwear"
  if (t.includes("dress") || t.includes("jumpsuit")) return "dress"
  if (t === "top") return "top"
  if (t === "bottom") return "bottom"
  if (t.includes("foot") || t.includes("shoe")) return "footwear"
  if (t.includes("accessor")) return "accessory"
  return "other"
}

/**
 * Deterministic jitter so identical outfits stay stable across runs but don't
 * look like a perfect template stamp.
 */
function jitter(seed: string, salt: number, amplitude: number): number {
  let h = salt * 2654435761
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 1597334677)
  }
  const unit = ((h >>> 0) % 2000) / 1000 - 1 // [-1, 1)
  return unit * amplitude
}

function slotToItem(id: string, slot: Slot): BoardLayoutItem {
  const width = Math.round(slot.width)
  const height = Math.round(slot.height)
  const posX = Math.round(clamp(slot.cx - width / 2, 0, CREATIVE_BOARD_SIZE - width))
  const posY = Math.round(clamp(slot.cy - height / 2, 0, CREATIVE_BOARD_SIZE - height))
  return {
    clothingItemId: id,
    posX,
    posY,
    width,
    height,
    zIndex: slot.zIndex,
    rotation: 0,
  }
}

/**
 * Builds a flat-lay outfit collage on the creative board.
 *
 * Pieces are placed by garment role: tops/dresses upper-center, bottoms below
 * with overlap, footwear near the bottom, outerwear behind to the side,
 * accessories overlapping corners. Slight position/size jitter keeps the
 * result from looking like a grid. Rotation is always 0 (CF Images does not
 * apply it when compositing thumbnails).
 */
export function buildOutfitCollageLayout(pieces: BoardPieceInput[]): BoardLayoutItem[] {
  if (pieces.length === 0) return []

  if (pieces.length === 1) {
    const only = pieces[0]
    const size = 720
    return [
      slotToItem(only.id, {
        cx: CREATIVE_BOARD_SIZE / 2,
        cy: CREATIVE_BOARD_SIZE / 2,
        width: size,
        height: size,
        zIndex: 0,
      }),
    ]
  }

  const buckets: Record<PieceRole, BoardPieceInput[]> = {
    outerwear: [],
    dress: [],
    top: [],
    bottom: [],
    footwear: [],
    accessory: [],
    other: [],
  }
  for (const piece of pieces) {
    buckets[resolveRole(piece.pieceType)].push(piece)
  }

  const hasBodyCore =
    buckets.dress.length > 0 || buckets.top.length > 0 || buckets.bottom.length > 0

  // Untyped / unknown pieces fill missing body roles so a type-less outfit
  // still reads as a vertical collage instead of a grid.
  if (!hasBodyCore && buckets.other.length > 0) {
    const [first, second, ...rest] = buckets.other
    if (first) buckets.top.push(first)
    if (second) buckets.bottom.push(second)
    buckets.other = rest
  } else if (buckets.other.length > 0) {
    // Spill leftovers into accessory-ish spots
    buckets.accessory.push(...buckets.other)
    buckets.other = []
  }

  const items: BoardLayoutItem[] = []
  let z = 0

  const push = (piece: BoardPieceInput, slot: Omit<Slot, "zIndex"> & { zIndex?: number }) => {
    items.push(
      slotToItem(piece.id, {
        ...slot,
        zIndex: slot.zIndex ?? z++,
      }),
    )
  }

  // Outerwear — back layer, upper-left, large
  buckets.outerwear.forEach((piece, i) => {
    push(piece, {
      cx: 420 + i * 40 + jitter(piece.id, 2, 30),
      cy: 380 + i * 50 + jitter(piece.id, 3, 25),
      width: 560 - i * 30,
      height: 640 - i * 20,
      zIndex: z++,
    })
  })

  // Dress / jumpsuit — tall hero center (replaces top+bottom stack)
  buckets.dress.forEach((piece, i) => {
    push(piece, {
      cx: 800 + i * 35 + jitter(piece.id, 5, 20),
      cy: 720 + i * 40 + jitter(piece.id, 6, 20),
      width: 580 - i * 20,
      height: 980 - i * 30,
      zIndex: z++,
    })
  })

  // Top — upper center, slightly large
  buckets.top.forEach((piece, i) => {
    const side = i % 2 === 0 ? 1 : -1
    push(piece, {
      cx: 780 + side * (i * 55) + jitter(piece.id, 8, 25),
      cy: 420 + Math.floor(i / 2) * 70 + jitter(piece.id, 9, 20),
      width: 520 - i * 25,
      height: 560 - i * 20,
      zIndex: z++,
    })
  })

  // Bottom — mid/lower center, overlaps top
  buckets.bottom.forEach((piece, i) => {
    const side = i % 2 === 0 ? -1 : 1
    push(piece, {
      cx: 820 + side * (i * 50) + jitter(piece.id, 11, 25),
      cy: 980 + Math.floor(i / 2) * 60 + jitter(piece.id, 12, 20),
      width: 500 - i * 20,
      height: 560 - i * 15,
      zIndex: z++,
    })
  })

  // Footwear — lower area, often offset
  buckets.footwear.forEach((piece, i) => {
    const side = i % 2 === 0 ? 1 : -1
    push(piece, {
      cx: 980 + side * (40 + i * 70) + jitter(piece.id, 14, 30),
      cy: 1280 + Math.floor(i / 2) * 40 + jitter(piece.id, 15, 20),
      width: 360 - i * 15,
      height: 300 - i * 10,
      zIndex: z++,
    })
  })

  // Accessories — corners / overlaps, smaller, on top
  buckets.accessory.forEach((piece, i) => {
    const corner = i % 4
    const bases = [
      { cx: 1180, cy: 280 },
      { cx: 320, cy: 1100 },
      { cx: 1240, cy: 900 },
      { cx: 400, cy: 260 },
    ] as const
    const base = bases[corner % bases.length]
    push(piece, {
      cx: base.cx + jitter(piece.id, 17, 35),
      cy: base.cy + jitter(piece.id, 18, 35),
      width: 300 - (i % 3) * 20,
      height: 300 - (i % 3) * 20,
      zIndex: 100 + i,
    })
  })

  // Ensure every piece stayed on-canvas after clamping
  return items.map((item) => ({
    ...item,
    posX: clamp(item.posX, 0, CREATIVE_BOARD_SIZE - item.width),
    posY: clamp(item.posY, 0, CREATIVE_BOARD_SIZE - item.height),
  }))
}

/**
 * @deprecated Prefer {@link buildOutfitCollageLayout}. Kept as a thin wrapper
 * for callers that only have piece IDs (no type metadata).
 */
export function buildDefaultBoardLayout(pieceIds: string[]): BoardLayoutItem[] {
  return buildOutfitCollageLayout(pieceIds.map((id) => ({ id })))
}

/**
 * Computes a padded axis-aligned bounding box around all board pieces,
 * clamped to the logical creative board. Axis-aligned only (rotation is
 * always 0 for weekly outfits).
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
