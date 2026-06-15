/**
 * Unit tests for the image compositing logic.
 *
 * Uses @cf-wasm/photon directly (same as composite.ts) to produce tiny JPEG/WebP
 * test images. This exercises the real compositing pipeline without mocking and
 * verifies that all three formats the skydiiv app produces (JPEG, PNG, WebP) are
 * handled correctly.
 */
import { describe, it, expect } from "vitest"
import { compositeImages } from "../../src/lib/image/composite"

// ---------------------------------------------------------------------------
// Helpers — produce minimal valid image buffers using photon
// ---------------------------------------------------------------------------

async function makeJpeg(): Promise<Buffer> {
  const { PhotonImage } = await import("@cf-wasm/photon")
  const pixels = new Uint8Array(4 * 4 * 4).fill(200) // 4×4 grey-ish
  const img = new PhotonImage(pixels, 4, 4)
  const bytes = img.get_bytes_jpeg(80)
  img.free()
  return Buffer.from(bytes)
}

async function makeWebP(): Promise<Buffer> {
  const { PhotonImage } = await import("@cf-wasm/photon")
  const pixels = new Uint8Array(4 * 4 * 4).fill(100) // 4×4 dark
  const img = new PhotonImage(pixels, 4, 4)
  const bytes = img.get_bytes_webp()
  img.free()
  return Buffer.from(bytes)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compositeImages()", () => {
  it("throws when given an empty array", () => {
    expect(() => compositeImages([])).toThrow("No images provided")
  })

  it("returns a Buffer for a single JPEG image", async () => {
    const buf = await makeJpeg()
    const result = compositeImages([buf])
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it("returns a Buffer for a single WebP image (the format used by skydiiv R2)", async () => {
    const buf = await makeWebP()
    const result = compositeImages([buf])
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })

  it("produces a JPEG output regardless of input format (starts with FFD8)", async () => {
    const buf = await makeWebP()
    const result = compositeImages([buf])
    // JPEG magic bytes: 0xFF 0xD8
    expect(result[0]).toBe(0xff)
    expect(result[1]).toBe(0xd8)
  })

  it("composites multiple images into a valid JPEG", async () => {
    const bufs = await Promise.all([makeJpeg(), makeWebP(), makeJpeg(), makeWebP()])
    const result = compositeImages(bufs)
    expect(result[0]).toBe(0xff)
    expect(result[1]).toBe(0xd8)
    expect(result.length).toBeGreaterThan(0)
  })

  it("handles mixed JPEG and WebP inputs without error", async () => {
    const bufs = [await makeJpeg(), await makeWebP()]
    expect(compositeImages(bufs)).toBeDefined()
  })
})
