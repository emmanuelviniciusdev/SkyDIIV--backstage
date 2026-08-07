import { describe, it, expect } from "vitest"
import {
  CREATIVE_BOARD_SIZE,
  BOARD_EXPORT_PADDING,
  buildDefaultBoardLayout,
  computeBoardExportBounds,
  boardThumbnailScale,
} from "../../src/lib/outfits/board-layout"

describe("buildDefaultBoardLayout()", () => {
  it("returns an empty array for no pieces", () => {
    expect(buildDefaultBoardLayout([])).toEqual([])
  })

  it("places a single piece centered on the board", () => {
    const [item] = buildDefaultBoardLayout(["a"])
    expect(item.clothingItemId).toBe("a")
    expect(item.zIndex).toBe(0)
    expect(item.rotation).toBe(0)
    expect(item.width).toBe(item.height)
    // Centered: origin + 0*stride
    expect(item.posX).toBeGreaterThan(0)
    expect(item.posY).toBeGreaterThan(0)
    expect(item.posX + item.width).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
    expect(item.posY + item.height).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
  })

  it("lays out 2 pieces in a 2-column grid with ascending zIndex", () => {
    const items = buildDefaultBoardLayout(["a", "b"])
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.zIndex)).toEqual([0, 1])
    expect(items[0].posY).toBe(items[1].posY)
    expect(items[1].posX).toBeGreaterThan(items[0].posX)
  })

  it("lays out 3 pieces as a 2-column grid (2 + 1)", () => {
    const items = buildDefaultBoardLayout(["a", "b", "c"])
    expect(items).toHaveLength(3)
    // First row: a, b
    expect(items[0].posY).toBe(items[1].posY)
    // Second row: c
    expect(items[2].posY).toBeGreaterThan(items[0].posY)
    expect(items.every((i) => i.rotation === 0)).toBe(true)
  })

  it("lays out 4 pieces in a 2×2 grid", () => {
    const items = buildDefaultBoardLayout(["a", "b", "c", "d"])
    expect(items).toHaveLength(4)
    expect(items[0].posX).toBe(items[2].posX)
    expect(items[1].posX).toBe(items[3].posX)
    expect(items[0].posY).toBe(items[1].posY)
    expect(items[2].posY).toBe(items[3].posY)
  })

  it("lays out 9 pieces in a 3×3 grid within the board", () => {
    const items = buildDefaultBoardLayout(Array.from({ length: 9 }, (_, i) => `p${i}`))
    expect(items).toHaveLength(9)
    for (const item of items) {
      expect(item.posX).toBeGreaterThanOrEqual(0)
      expect(item.posY).toBeGreaterThanOrEqual(0)
      expect(item.posX + item.width).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
      expect(item.posY + item.height).toBeLessThanOrEqual(CREATIVE_BOARD_SIZE)
    }
    // Bottom-right piece should be furthest
    expect(items[8].posX).toBeGreaterThan(items[0].posX)
    expect(items[8].posY).toBeGreaterThan(items[0].posY)
  })

  it("matches the web app cell-size formula for n=4", () => {
    // cols = ceil(sqrt(4)) = 2
    // cell = min(360, floor(1600 / 2.5)) = min(360, 640) = 360
    // gap = floor(360 * 0.12) = 43
    // size = 360 - 43 = 317
    const items = buildDefaultBoardLayout(["a", "b", "c", "d"])
    expect(items[0].width).toBe(317)
    expect(items[0].height).toBe(317)
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
    const layout = buildDefaultBoardLayout(["a", "b"])
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
