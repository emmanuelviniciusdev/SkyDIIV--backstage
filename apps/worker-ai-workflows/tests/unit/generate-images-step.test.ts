/**
 * Unit tests for the generate-images workflow step.
 *
 * External boundaries (CF Images binding, DB, R2, fetch) are replaced by
 * vi mocks so the tests run without any real network calls or Worker bindings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildOutfitCollageLayout } from "../../src/lib/outfits/board-layout"

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before any imports that reference them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockOutput = vi.fn().mockResolvedValue({
    response: () => new Response(new Uint8Array([0x89, 0x50]).buffer, { status: 200 }),
  })
  const mockDraw = vi.fn()
  const mockTransform = vi.fn()
  const mockInput = vi.fn()

  const pipeline = { transform: mockTransform, draw: mockDraw, output: mockOutput }
  mockTransform.mockReturnValue(pipeline)
  mockDraw.mockReturnValue(pipeline)
  mockInput.mockReturnValue(pipeline)

  const mockGetImages = vi.fn().mockReturnValue({ input: mockInput })

  const mockUpdateOutfitImageUrl = vi.fn().mockResolvedValue(undefined)
  const mockUploadImageToR2 = vi.fn().mockResolvedValue("https://r2.example.com/outfits/outfit-1.png")
  const mockReadDb = vi.fn()
  const mockWriteDb = vi.fn() as ReturnType<typeof vi.fn> & { begin?: ReturnType<typeof vi.fn> }
  mockWriteDb.begin = vi.fn().mockResolvedValue([])

  return {
    mockGetImages,
    mockInput,
    mockTransform,
    mockDraw,
    mockOutput,
    pipeline,
    mockUpdateOutfitImageUrl,
    mockUploadImageToR2,
    mockReadDb,
    mockWriteDb,
  }
})

vi.mock("../../src/lib/cf-images", () => ({
  getImages: mocks.mockGetImages,
}))

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.mockReadDb,
  getWriteDb: () => mocks.mockWriteDb,
  resetDbClients: vi.fn(),
}))

vi.mock("../../src/lib/db/weekly-outfits.repository", () => ({
  SqlWeeklyOutfitsRepository: vi.fn(function () {
    return { updateOutfitImageUrl: mocks.mockUpdateOutfitImageUrl }
  }),
}))

vi.mock("../../src/lib/storage/r2-client", () => ({
  uploadImageToR2: mocks.mockUploadImageToR2,
  deleteImageFromR2: vi.fn().mockResolvedValue(undefined),
}))

import { generateImageStep } from "../../src/workflows/generate-weekly-outfits/steps/generate-images"

const USER_ID = "user-generate-images-test"

function outfitWithLayout(
  outfitId: string,
  weekday: string,
  pieces: Array<{ id: string; pieceType: string }>,
) {
  const clothingPieceIds = pieces.map((p) => p.id)
  return {
    outfitId,
    weekday,
    clothingPieceIds,
    layout: buildOutfitCollageLayout(pieces),
  }
}

const OUTFIT_1 = outfitWithLayout("outfit-1", "sunday", [
  { id: "item-1", pieceType: "Top" },
  { id: "item-2", pieceType: "Bottom" },
])
const OUTFIT_2 = outfitWithLayout("outfit-2", "monday", [{ id: "item-3", pieceType: "Footwear" }])

const WARDROBE_IMAGE_MAP = {
  "item-1": "https://r2.example.com/items/item-1.jpg",
  "item-2": "https://r2.example.com/items/item-2.jpg",
  "item-3": "https://r2.example.com/items/item-3.jpg",
}

describe("generateImageStep()", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.mockTransform.mockReturnValue(mocks.pipeline)
    mocks.mockDraw.mockReturnValue(mocks.pipeline)
    mocks.mockInput.mockReturnValue(mocks.pipeline)
    mocks.mockGetImages.mockReturnValue({ input: mocks.mockInput })
    mocks.mockOutput.mockResolvedValue({
      response: () => new Response(new Uint8Array([0x89, 0x50]).buffer, { status: 200 }),
    })
    mocks.mockUploadImageToR2.mockResolvedValue("https://r2.example.com/outfits/outfit-1.png")

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream(),
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x89, 0x50]).buffer),
      }),
    )
  })

  it("calls the CF Images binding and returns true when outfit has images", async () => {
    const result = await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(mocks.mockInput).toHaveBeenCalled()
    expect(mocks.mockOutput).toHaveBeenCalledWith({ format: "image/png" })
    expect(result).toBe(true)
  })

  it("squeezes a transparent pixel to canvas size (avoids pink pad base)", async () => {
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })

    const squeezeCall = mocks.mockTransform.mock.calls.find(
      (args) => (args[0] as { fit?: string }).fit === "squeeze",
    )
    expect(squeezeCall).toBeDefined()
    expect(squeezeCall![0]).toMatchObject({
      fit: "squeeze",
      width: expect.any(Number),
      height: expect.any(Number),
    })
    expect((squeezeCall![0] as { background?: string }).background).toBeUndefined()
  })

  it("pads each piece into its layout cell so the full image stays visible", async () => {
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })

    const piecePadCalls = mocks.mockTransform.mock.calls.filter(
      (args) => (args[0] as { fit?: string }).fit === "pad",
    )
    expect(piecePadCalls.length).toBe(2)
    for (const call of piecePadCalls) {
      expect(call[0]).toMatchObject({
        fit: "pad",
        background: "rgba(0,0,0,0)",
      })
    }

    const firstDrawOpts = mocks.mockDraw.mock.calls[0][1] as {
      top: number
      left: number
      width: number
      height: number
    }
    expect(firstDrawOpts.width).toBeGreaterThan(0)
    expect(firstDrawOpts.height).toBeGreaterThan(0)
  })

  it("draws one overlay per piece image at scaled board positions", async () => {
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(mocks.mockDraw).toHaveBeenCalledTimes(2)

    const firstDrawOpts = mocks.mockDraw.mock.calls[0][1] as { top: number; left: number }
    const secondDrawOpts = mocks.mockDraw.mock.calls[1][1] as { top: number; left: number }
    expect(typeof firstDrawOpts.top).toBe("number")
    expect(typeof firstDrawOpts.left).toBe("number")
    // Flat-lay: bottom piece sits below the top piece
    expect(secondDrawOpts.top).toBeGreaterThan(firstDrawOpts.top)
  })

  it("batches draws across multiple pipelines for outfits with many pieces", async () => {
    const pieceIds = Array.from({ length: 10 }, (_, i) => `item-${i}`)
    const manyPieceMap = Object.fromEntries(
      pieceIds.map((id) => [id, `https://r2.example.com/items/${id}.jpg`]),
    )
    const outfit = outfitWithLayout(
      "outfit-many",
      "sunday",
      pieceIds.map((id, i) => {
        const types = ["Top", "Bottom", "Footwear", "Accessory", "Outerwear"] as const
        return { id, pieceType: types[i % types.length] }
      }),
    )

    const result = await generateImageStep({
      userId: USER_ID,
      outfit,
      wardrobeImageMap: manyPieceMap,
    })

    expect(result).toBe(true)
    expect(mocks.mockDraw).toHaveBeenCalledTimes(10)
    expect(mocks.mockOutput.mock.calls.length).toBeGreaterThan(1)
  })

  it("uploads a PNG to R2 with userid metadata and returns true", async () => {
    const result = await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(mocks.mockUploadImageToR2).toHaveBeenCalledTimes(1)
    const [, key, metadata, contentType] = mocks.mockUploadImageToR2.mock.calls[0]
    expect(key).toBe("outfits/outfit-1.png")
    expect(metadata).toEqual({ userid: USER_ID })
    expect(contentType).toBe("image/png")
    expect(result).toBe(true)
  })

  it("updates outfit image_url in DB after upload", async () => {
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(mocks.mockUpdateOutfitImageUrl).toHaveBeenCalledWith(
      "outfit-1",
      "https://r2.example.com/outfits/outfit-1.png",
    )
  })

  it("returns false and skips the binding when outfit pieces have no images", async () => {
    const result = await generateImageStep({
      userId: USER_ID,
      outfit: outfitWithLayout("outfit-noimg", "tuesday", [{ id: "item-unknown", pieceType: "Top" }]),
      wardrobeImageMap: {},
    })
    expect(result).toBe(false)
    expect(mocks.mockInput).not.toHaveBeenCalled()
    expect(mocks.mockUploadImageToR2).not.toHaveBeenCalled()
  })

  it("returns false when all piece image fetches fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))

    const result = await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(result).toBe(false)
    expect(mocks.mockInput).not.toHaveBeenCalled()
  })

  it("proceeds with remaining pieces when one fetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error on item-1"))
      .mockResolvedValue({
        ok: true,
        body: new ReadableStream(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      })
    vi.stubGlobal("fetch", fetchMock)

    const result = await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(mocks.mockDraw).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it("throws when the CF Images binding fails", async () => {
    mocks.mockOutput.mockRejectedValueOnce(new Error("Images binding error"))

    await expect(
      generateImageStep({
        userId: USER_ID,
        outfit: OUTFIT_1,
        wardrobeImageMap: WARDROBE_IMAGE_MAP,
      }),
    ).rejects.toThrow("Images binding error")
  })

  it("fetches only piece images present in wardrobeImageMap", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    })
    vi.stubGlobal("fetch", fetchMock)

    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: { "item-1": "https://r2.example.com/items/item-1.jpg" },
    })

    const fetchedUrls = fetchMock.mock.calls.map((c: [string]) => c[0])
    expect(fetchedUrls.some((u: string) => u.includes("item-2"))).toBe(false)
    expect(fetchedUrls.some((u: string) => u.includes("item-1"))).toBe(true)
  })

  it("calls the binding for multiple outfits when called in sequence", async () => {
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_2,
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })
    expect(mocks.mockDraw).toHaveBeenCalledTimes(3)
  })
})
