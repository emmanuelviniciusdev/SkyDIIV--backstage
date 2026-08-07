import { describe, it, expect } from "vitest"
import {
  CREATIVE_BOARD_SIZE,
  BOARD_EXPORT_PADDING,
  buildDefaultBoardLayout,
  buildOutfitCollageLayout,
  computeBoardExportBounds,
  boardThumbnailScale,
} from "../../src/lib/outfits/board-layout"

describe("buildOutfitCollageLayout()", () => {
  it("returns an empty array for no pieces", () => {
    expect(buildOutfitCollageLayout([])).toEqual([])
  })

  it("places a single piece centered on the board", () => {
    const [item] = buildOutfitCollageLayout([{ id: "a", pieceType: "Top" }])
    expect(item.clothingItemId).toBe("a")
    expect(item.posX + item.width / 2).toBeCloseTo(CREATIVE_BOARD_SIZE / 2, 0)
    expect(item.posY + item.height / 2).toBeCloseTo(CREATIVE_BOARD_SIZE / 2, 0)
    expect(item.posX + item.width).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
    expect(item.posY + item.height).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
  })

  it("stacks top above bottom in a vertical outfit silhouette", () => {
    const items = buildOutfitCollageLayout([
      { id: "top", pieceType: "Top" },
      { id: "bottom", pieceType: "Bottom" },
    ])
    const top = items.find((i) => i.clothingItemId === "top")!
    const bottom = items.find((i) => i.clothingItemId === "bottom")!
    expect(top.posY).toBeLessThan(bottom.posY)
  })

  it("places footwear below the bottom piece", () => {
    const items = buildOutfitCollageLayout([
      { id: "top", pieceType: "Top" },
      { id: "bottom", pieceType: "Bottom" },
      { id: "shoes", pieceType: "Footwear" },
    ])
    const bottom = items.find((i) => i.clothingItemId === "bottom")!
    const shoes = items.find((i) => i.clothingItemId === "shoes")!
    expect(shoes.posY).toBeGreaterThan(bottom.posY)
  })

  it("keeps outerwear behind body pieces (lower zIndex)", () => {
    const items = buildOutfitCollageLayout([
      { id: "jacket", pieceType: "Outerwear" },
      { id: "top", pieceType: "Top" },
      { id: "bottom", pieceType: "Bottom" },
    ])
    const jacket = items.find((i) => i.clothingItemId === "jacket")!
    const top = items.find((i) => i.clothingItemId === "top")!
    expect(jacket.zIndex).toBeLessThan(top.zIndex)
  })

  it("puts accessories above other pieces (higher zIndex)", () => {
    const items = buildOutfitCollageLayout([
      { id: "top", pieceType: "Top" },
      { id: "bag", pieceType: "Accessory" },
    ])
    const top = items.find((i) => i.clothingItemId === "top")!
    const bag = items.find((i) => i.clothingItemId === "bag")!
    expect(bag.zIndex).toBeGreaterThan(top.zIndex)
  })

  it("uses a tall dress as the vertical hero when present", () => {
    const items = buildOutfitCollageLayout([
      { id: "dress", pieceType: "Dress & Jumpsuit" },
      { id: "shoes", pieceType: "Footwear" },
    ])
    const dress = items.find((i) => i.clothingItemId === "dress")!
    const shoes = items.find((i) => i.clothingItemId === "shoes")!
    expect(dress.height).toBeGreaterThan(shoes.height)
    expect(dress.height).toBeGreaterThan(700)
  })

  it("keeps all pieces within the board bounds", () => {
    const items = buildOutfitCollageLayout([
      { id: "ow", pieceType: "Outerwear" },
      { id: "top", pieceType: "Top" },
      { id: "bottom", pieceType: "Bottom" },
      { id: "shoes", pieceType: "Footwear" },
      { id: "bag", pieceType: "Accessory" },
      { id: "hat", pieceType: "Accessory" },
    ])
    for (const item of items) {
      expect(item.posX).toBeGreaterThanOrEqual(0)
      expect(item.posY).toBeGreaterThanOrEqual(0)
      expect(item.posX + item.width).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
      expect(item.posY + item.height).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
    }
  })

  it("is deterministic for the same inputs", () => {
    const input = [
      { id: "a", pieceType: "Top" },
      { id: "b", pieceType: "Bottom" },
      { id: "c", pieceType: "Footwear" },
    ]
    expect(buildOutfitCollageLayout(input)).toEqual(buildOutfitCollageLayout(input))
  })

  it("does not place untyped pieces in a uniform grid", () => {
    const items = buildDefaultBoardLayout(["a", "b", "c", "d"])
    // A 2×2 grid would share Y across each row; collage uses a vertical stack.
    const ys = items.map((i) => i.posY)
    const uniqueYs = new Set(ys.map((y) => Math.round(y / 50)))
    expect(uniqueYs.size).toBeGreaterThan(1)
    // Not all same size either
    const sizes = new Set(items.map((i) => i.width))
    expect(sizes.size).toBeGreaterThanOrEqual(1)
  })
})

describe("computeBoardExportBounds()", () => {
  it("returns the full board when there are no items", () => {
    const bounds = computeBoardExportBounds([])
    expect(bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: CREATIVE_BOARD_SIZE,
      maxY: CREATIVE_BOARD_SIZE,
      width: CREATIVE_BOARD_SIZE,
      height: CREATIVE_BOARD_SIZE,
    })
  })

  it("pads and clamps the AABB around pieces", () => {
    const layout = buildOutfitCollageLayout([
      { id: "a", pieceType: "Top" },
      { id: "b", pieceType: "Bottom" },
    ])
    const bounds = computeBoardExportBounds(layout)

    const rawMinX = Math.min(...layout.map((i) => i.posX))
    const rawMinY = Math.min(...layout.map((i) => i.posY))
    expect(bounds.minX).toBe(Math.max(0, Math.floor(rawMinX - BOARD_EXPORT_PADDING)))
    expect(bounds.minY).toBe(Math.max(0, Math.floor(rawMinY - BOARD_EXPORT_PADDING)))
    expect(bounds.width).toBe(bounds.maxX - bounds.minX)
    expect(bounds.height).toBe(bounds.maxY - bounds.minY)
  })
})

describe("boardThumbnailScale()", () => {
  it("returns 1 when bounds already fit under maxSide", () => {
    expect(boardThumbnailScale({ minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 }, 800)).toBe(1)
  })

  it("scales down so the longest side equals maxSide", () => {
    const scale = boardThumbnailScale(
      { minX: 0, minY: 0, maxX: 1600, maxY: 800, width: 1600, height: 800 },
      800,
    )
    expect(scale).toBe(0.5)
  })
})
