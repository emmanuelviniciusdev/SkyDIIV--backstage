/**
 * Unit tests for the generate-images workflow step.
 *
 * All external boundaries (DB, image compositing, R2 upload, fetch) are
 * replaced by vi mocks so the tests run without network calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks — must be created before any imports that reference them
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockUpdateOutfitImageUrl = vi.fn().mockResolvedValue(undefined)
  const mockSaveWeeklyOutfits = vi.fn().mockResolvedValue([])
  const mockReadDb = vi.fn().mockResolvedValue([])
  const mockWriteDb = vi.fn().mockResolvedValue([]) as ReturnType<typeof vi.fn> & {
    begin?: ReturnType<typeof vi.fn>
  }
  mockWriteDb.begin = vi.fn().mockResolvedValue([])

  const mockCompositeImages = vi.fn().mockReturnValue(Buffer.from("fake-jpeg"))
  const mockUploadImageToR2 = vi.fn().mockResolvedValue("https://r2.example.com/outfits/outfit-1.jpg")

  return {
    mockUpdateOutfitImageUrl,
    mockSaveWeeklyOutfits,
    mockReadDb,
    mockWriteDb,
    mockCompositeImages,
    mockUploadImageToR2,
  }
})

vi.mock("../../src/lib/db/client", () => ({
  getReadDb: () => mocks.mockReadDb,
  getWriteDb: () => mocks.mockWriteDb,
  resetDbClients: vi.fn(),
}))

vi.mock("../../src/lib/db/weekly-outfits.repository", () => ({
  // Use a regular function (not arrow) so it is constructable with `new`
  SqlWeeklyOutfitsRepository: vi.fn(function () {
    return {
      saveWeeklyOutfits: mocks.mockSaveWeeklyOutfits,
      updateOutfitImageUrl: mocks.mockUpdateOutfitImageUrl,
    }
  }),
}))

vi.mock("../../src/lib/image/composite", () => ({
  compositeImages: mocks.mockCompositeImages,
}))

vi.mock("../../src/lib/storage/r2-client", () => ({
  uploadImageToR2: mocks.mockUploadImageToR2,
}))

// ---------------------------------------------------------------------------
// Import step AFTER mocks are registered
// ---------------------------------------------------------------------------

import { generateImagesStep } from "../../src/steps/generate-images"

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

describe("generateImagesStep()", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: fetch returns a valid 2-byte JPEG stub
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xd8]).buffer),
    }))
  })

  it("calls compositeImages once per outfit with images", async () => {
    await generateImagesStep({ userId: USER_ID, savedOutfits: [OUTFIT_1, OUTFIT_2], wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(mocks.mockCompositeImages).toHaveBeenCalledTimes(2)
  })

  it("uploads one image per outfit to R2", async () => {
    await generateImagesStep({ userId: USER_ID, savedOutfits: [OUTFIT_1], wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(mocks.mockUploadImageToR2).toHaveBeenCalledTimes(1)
    const [, key] = mocks.mockUploadImageToR2.mock.calls[0]
    expect(key).toContain("outfit-1")
  })

  it("updates outfit image_url in DB after upload", async () => {
    await generateImagesStep({ userId: USER_ID, savedOutfits: [OUTFIT_1], wardrobeImageMap: WARDROBE_IMAGE_MAP })
    expect(mocks.mockUpdateOutfitImageUrl).toHaveBeenCalledWith(
      "outfit-1",
      "https://r2.example.com/outfits/outfit-1.jpg",
    )
  })

  it("skips outfits whose pieces have no images in the map", async () => {
    await generateImagesStep({
      userId: USER_ID,
      savedOutfits: [{ outfitId: "outfit-noimg", weekday: "tuesday", clothingPieceIds: ["item-unknown"] }],
      wardrobeImageMap: {},
    })
    expect(mocks.mockCompositeImages).not.toHaveBeenCalled()
    expect(mocks.mockUploadImageToR2).not.toHaveBeenCalled()
    expect(mocks.mockUpdateOutfitImageUrl).not.toHaveBeenCalled()
  })

  it("skips an outfit when all image fetches fail but does not crash", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")))

    await expect(
      generateImagesStep({ userId: USER_ID, savedOutfits: [OUTFIT_1], wardrobeImageMap: WARDROBE_IMAGE_MAP }),
    ).resolves.toBeUndefined()

    expect(mocks.mockCompositeImages).not.toHaveBeenCalled()
  })

  it("continues processing remaining outfits when one fails", async () => {
    mocks.mockCompositeImages
      .mockImplementationOnce(() => { throw new Error("Composite error on outfit 1") })
      .mockReturnValueOnce(Buffer.from("fake-jpeg"))

    await generateImagesStep({
      userId: USER_ID,
      savedOutfits: [OUTFIT_1, OUTFIT_2],
      wardrobeImageMap: WARDROBE_IMAGE_MAP,
    })

    // First outfit failed but second should still be processed
    expect(mocks.mockCompositeImages).toHaveBeenCalledTimes(2)
    expect(mocks.mockUploadImageToR2).toHaveBeenCalledTimes(1)
    expect(mocks.mockUpdateOutfitImageUrl).toHaveBeenCalledTimes(1)
  })

  it("completes without throwing for an empty savedOutfits list", async () => {
    await expect(
      generateImagesStep({ userId: USER_ID, savedOutfits: [], wardrobeImageMap: WARDROBE_IMAGE_MAP }),
    ).resolves.toBeUndefined()
  })

  it("fetches only piece images that are present in the wardrobeImageMap", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xd8]).buffer),
    })
    vi.stubGlobal("fetch", fetchMock)

    const partialMap = {
      "item-1": "https://r2.example.com/items/item-1.jpg",
      // item-2 is missing
    }

    await generateImagesStep({
      userId: USER_ID,
      savedOutfits: [OUTFIT_1], // has item-1 and item-2
      wardrobeImageMap: partialMap,
    })

    // Only 1 fetch for item-1 (item-2 has no URL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("https://r2.example.com/items/item-1.jpg")
  })
})
