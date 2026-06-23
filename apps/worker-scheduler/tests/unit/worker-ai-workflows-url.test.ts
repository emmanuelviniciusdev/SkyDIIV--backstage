import { describe, it, expect } from "vitest"
import {
  resolveGenerateWeeklyOutfitsUrl,
  resolveGenerateWardrobePanoramaUrl,
} from "../../src/lib/worker-ai-workflows-url"

describe("worker-ai-workflows URL helpers", () => {
  it("resolveGenerateWeeklyOutfitsUrl appends /generate-weekly-outfits to WORKER_AI_WORKFLOWS_URL", () => {
    process.env.WORKER_AI_WORKFLOWS_URL = "https://worker-ai-workflows.example.workers.dev"
    expect(resolveGenerateWeeklyOutfitsUrl()).toBe(
      "https://worker-ai-workflows.example.workers.dev/generate-weekly-outfits",
    )
  })

  it("resolveGenerateWardrobePanoramaUrl appends /generate-wardrobe-panorama to WORKER_AI_WORKFLOWS_URL", () => {
    process.env.WORKER_AI_WORKFLOWS_URL = "https://worker-ai-workflows.example.workers.dev/"
    expect(resolveGenerateWardrobePanoramaUrl()).toBe(
      "https://worker-ai-workflows.example.workers.dev/generate-wardrobe-panorama",
    )
  })

  it("throws when WORKER_AI_WORKFLOWS_URL is not configured", () => {
    delete process.env.WORKER_AI_WORKFLOWS_URL
    expect(() => resolveGenerateWeeklyOutfitsUrl()).toThrow(
      "WORKER_AI_WORKFLOWS_URL environment variable is not set",
    )
  })
})
