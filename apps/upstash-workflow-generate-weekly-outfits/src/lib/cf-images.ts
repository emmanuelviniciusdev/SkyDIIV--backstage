/**
 * Minimal types for the Cloudflare Images binding (env.IMAGES).
 * Only the subset used by generate-images.ts is typed here.
 * Full docs: https://developers.cloudflare.com/images/optimization/transformations/bindings/
 */

export interface DrawOptions {
  top?: number
  left?: number
  bottom?: number
  right?: number
  opacity?: number
  repeat?: boolean | "x" | "y"
}

export interface ImageTransformOptions {
  width?: number
  height?: number
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad"
  quality?: number
  format?: string
  rotate?: number
}

export interface OutputOptions {
  format: "image/jpeg" | "image/png" | "image/webp" | "image/avif"
  quality?: number
}

export interface ImageOutput {
  response(): Response
}

export interface ImageTransformer {
  transform(options: ImageTransformOptions): ImageTransformer
  draw(source: ReadableStream | ArrayBuffer | ImageTransformer, options?: DrawOptions): ImageTransformer
  output(options: OutputOptions): Promise<ImageOutput>
}

export interface ImagesBinding {
  input(source: ReadableStream | ArrayBuffer): ImageTransformer
}

// ---------------------------------------------------------------------------
// Module-level singleton — set once per request in index.ts, then read by
// generate-images.ts inside the workflow step. Safe because each Upstash
// Workflow step is a new Worker request, so index.ts always runs first.
// ---------------------------------------------------------------------------

let _binding: ImagesBinding | undefined

export function setImages(binding: ImagesBinding): void {
  _binding = binding
}

export function getImages(): ImagesBinding {
  if (!_binding) {
    throw new Error(
      "IMAGES binding is not initialised. " +
      "Ensure [images] binding = \"IMAGES\" is declared in wrangler.toml " +
      "and setImages(env.IMAGES) is called in the Worker fetch handler.",
    )
  }
  return _binding
}

/** Resets the singleton (useful between tests). */
export function resetImages(): void {
  _binding = undefined
}
