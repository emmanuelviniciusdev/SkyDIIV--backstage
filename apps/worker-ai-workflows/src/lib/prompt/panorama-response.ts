export interface ParsedWardrobePanoramaResponse {
  /** Markdown panorama. A leftover trailing JSON fence is stripped if present. */
  content: string
}

const JSON_FENCE_RE = new RegExp("```(?:json)?\\s*([\\s\\S]*?)\\s*```\\s*$", "i")

/**
 * Parses the LLM response as markdown panorama content.
 * A trailing fenced JSON block is ignored when present so leftover shopping-suggestions
 * output cannot fail the workflow.
 */
export function parseWardrobePanoramaResponse(raw: string): ParsedWardrobePanoramaResponse {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error("LLM response is empty")
  }

  const fenceMatch = trimmed.match(JSON_FENCE_RE)
  if (fenceMatch && fenceMatch.index !== undefined) {
    const content = trimmed.slice(0, fenceMatch.index).trim()
    if (!content) {
      throw new Error("LLM response has an empty markdown panorama")
    }
    return { content }
  }

  return { content: trimmed }
}
