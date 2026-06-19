/**
 * Unit tests for the generate-images workflow step.
 *
 * External boundaries (CF Images binding, DB, R2, fetch) are replaced by
 * vi mocks so the tests run without any real network calls or Worker bindings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before any imports that reference them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // CF Images binding mock
  const mockOutput = vi.fn().mockResolvedValue({
    response: () => new Response(new Uint8Array([0xff, 0xd8]).buffer, { status: 200 }),
  })
  const mockDraw = vi.fn()
  const mockTransform = vi.fn()
  const mockInput = vi.fn()

  // Fluent API: each method returns the same object so chains work
  const pipeline = { transform: mockTransform, draw: mockDraw, output: mockOutput }
  mockTransform.mockReturnValue(pipeline)
  mockDraw.mockReturnValue(pipeline)
  mockInput.mockReturnValue(pipeline)

  const mockGetImages = vi.fn().mockReturnValue({ input: mockInput })

  // DB / R2 mocks
  const mockUpdateOutfitImageUrl = vi.fn().mockResolvedValue(undefined)
  const mockUploadImageToR2 = vi.fn().mockResolvedValue("https://r2.example.com/outfits/outfit-1.jpg")
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

// ---------------------------------------------------------------------------
// Import step AFTER mocks are registered
// ---------------------------------------------------------------------------

import { generateImageStep } from "../../src/workflows/generate-weekly-outfits/steps/generate-images"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-generate-images-test"
const OUTFIT_1 = { outfitId: "outfit-1", weekday: "sunday", clothingPieceIds: ["item-1", "item-2"] }
const OUTFIT_2 = { outfitId: "outfit-2", weekday: "monday", clothingPieceIds: ["item-3"] }

const WARDROBE_IMAGE_MAP = {
  "item-1": "https://r2.example.com/items/item-1.jpg",
  "item-2": "https://r2.example.com/items/item-2.jpg",
  "item-3": "https://r2.example.com/items/item-3.jpg",
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateImageStep()", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Re-wire the fluent chain after clearAllMocks resets return values
    mocks.mockTransform.mockReturnValue(mocks.pipeline)
    mocks.mockDraw.mockReturnValue(mocks.pipeline)
    mocks.mockInput.mockReturnValue(mocks.pipeline)
    mocks.mockGetImages.mockReturnValue({ input: mocks.mockInput })
    mocks.mockOutput.mockResolvedValue({
      response: () => new Response(new Uint8Array([0xff, 0xd8]).buffer, { status: 200 }),
    })
    mocks.mockUploadImageToR2.mockResolvedValue("https://r2.example.com/outfits/outfit-1.jpg")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xd8]).buffer),
    }))
  })

  it("calls the CF Images binding and returns true when outfit has images", async () => {
    const result = await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(mocks.mockInput).toHaveBeenCalled()
    expect(mocks.mockOutput).toHaveBeenCalledWith({ format: "image/jpeg", quality: 85 })
    expect(result).toBe(true)
  })

  it("draws one overlay per piece image", async () => {
    await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    // OUTFIT_1 has 2 pieces → 2 draw calls
    expect(mocks.mockDraw).toHaveBeenCalledTimes(2)
  })

  it("batches draws across multiple pipelines for outfits with many pieces", async () => {
    // 10 pieces would overflow a single CF Images pipeline (10-op limit), so
    // they must be composited across several batched .output() executions.
    const pieceIds = Array.from({ length: 10 }, (_, i) => `item-${i}`)
    const manyPieceMap = Object.fromEntries(
      pieceIds.map((id) => [id, `https://r2.example.com/items/${id}.jpg`]),
    )
    const outfit = { outfitId: "outfit-many", weekday: "sunday", clothingPieceIds: pieceIds }

    const result = await generateImageStep({ userId: USER_ID, outfit, wardrobeImageMap: manyPieceMap })

    expect(result).toBe(true)
    // One draw per piece, regardless of how many pipelines they were split across.
    expect(mocks.mockDraw).toHaveBeenCalledTimes(10)
    // Background pipeline + at least one batched pipeline → multiple outputs.
    expect(mocks.mockOutput.mock.calls.length).toBeGreaterThan(1)
  })

  it("uploads the output to R2 with userid metadata and returns true", async () => {
    const result = await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(mocks.mockUploadImageToR2).toHaveBeenCalledTimes(1)
    const [, key, metadata] = mocks.mockUploadImageToR2.mock.calls[0]
    expect(key).toContain("outfit-1")
    expect(metadata).toEqual({ userid: USER_ID })
    expect(result).toBe(true)
  })

  it("updates outfit image_url in DB after upload", async () => {
    await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(mocks.mockUpdateOutfitImageUrl).toHaveBeenCalledWith(
      "outfit-1",
      "https://r2.example.com/outfits/outfit-1.jpg",
    )
  })

  it("returns false and skips the binding when outfit pieces have no images", async () => {
    const result = await generateImageStep({
      userId: USER_ID,
      outfit: { outfitId: "outfit-noimg", weekday: "tuesday", clothingPieceIds: ["item-unknown"] },
      wardrobeImageMap: {},
    })
    expect(result).toBe(false)
    expect(mocks.mockInput).not.toHaveBeenCalled()
    expect(mocks.mockUploadImageToR2).not.toHaveBeenCalled()
  })

  it("returns false when all piece image fetches fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))

    const result = await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(result).toBe(false)
    expect(mocks.mockInput).not.toHaveBeenCalled()
  })

  it("proceeds with remaining pieces when one fetch fails", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Network error on item-1"))
      .mockResolvedValue({ ok: true, body: new ReadableStream(), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    vi.stubGlobal("fetch", fetchMock)

    // OUTFIT_1 has 2 pieces; item-1 fails, item-2 succeeds
    const result = await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    // Only 1 valid stream → 1 draw call
    expect(mocks.mockDraw).toHaveBeenCalledTimes(1)
    expect(result).toBe(true)
  })

  it("throws when the CF Images binding fails", async () => {
    mocks.mockOutput.mockRejectedValueOnce(new Error("Images binding error"))

    await expect(
      generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP }),
    ).rejects.toThrow("Images binding error")
  })

  it("fetches only piece images present in wardrobeImageMap", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream(), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
    vi.stubGlobal("fetch", fetchMock)

    // partialMap omits item-2
    await generateImageStep({
      userId: USER_ID,
      outfit: OUTFIT_1,
      wardrobeImageMap: { "item-1": "https://r2.example.com/items/item-1.jpg" },
    })

    const fetchedUrls = fetchMock.mock.calls.map((c: [string]) => c[0])
    // item-2 has no URL in the map — it must never be fetched
    expect(fetchedUrls.some((u: string) => u.includes("item-2"))).toBe(false)
    // item-1 IS in the map and must be fetched (at least once; it's also used as the base)
    expect(fetchedUrls.some((u: string) => u.includes("item-1"))).toBe(true)
  })

  it("calls the binding for multiple outfits when called in sequence", async () => {
    await generateImageStep({ userId: USER_ID, outfit: OUTFIT_1, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    await generateImageStep({ userId: USER_ID, outfit: OUTFIT_2, wardrobeImageMap: WARDROBE_IMAGE_MAP })
    // OUTFIT_1 has 2 pieces + OUTFIT_2 has 1 piece = 3 draw calls total
    expect(mocks.mockDraw).toHaveBeenCalledTimes(3)
  })
})
