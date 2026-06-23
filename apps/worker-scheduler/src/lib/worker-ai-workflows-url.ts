const GENERATE_WEEKLY_OUTFITS_PATH = "/generate-weekly-outfits"
const GENERATE_WARDROBE_PANORAMA_PATH = "/generate-wardrobe-panorama"

function resolveWorkerAiWorkflowsUrl(path: string): string {
  const baseUrl = process.env.WORKER_AI_WORKFLOWS_URL
  if (!baseUrl?.trim()) {
    throw new Error("WORKER_AI_WORKFLOWS_URL environment variable is not set")
  }
  return new URL(path, baseUrl.trim()).toString()
}

export function resolveGenerateWeeklyOutfitsUrl(): string {
  return resolveWorkerAiWorkflowsUrl(GENERATE_WEEKLY_OUTFITS_PATH)
}

export function resolveGenerateWardrobePanoramaUrl(): string {
  return resolveWorkerAiWorkflowsUrl(GENERATE_WARDROBE_PANORAMA_PATH)
}
