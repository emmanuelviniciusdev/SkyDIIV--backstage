import { z } from "zod"

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
}

const SummarySchema = z.string().trim().min(1)

/**
 * Parses summarizer LLM output to a single non-empty trimmed string.
 * Accepts a raw string or `{ "summary": "..." }`.
 */
export function parseFeedbackSummaryLlmOutput(raw: string): string {
  const cleaned = stripMarkdownFences(raw.trim())

  let candidate = cleaned
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      throw new Error(`Feedback summary LLM response is not valid JSON:\n${cleaned.slice(0, 300)}`)
    }
    if (typeof parsed === "string") {
      candidate = parsed
    } else if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (!("summary" in parsed)) {
        throw new Error("Feedback summary LLM response does not contain a summary string")
      }
      candidate = String(parsed.summary)
    } else {
      throw new Error("Feedback summary LLM response does not contain a summary string")
    }
  }

  const result = SummarySchema.safeParse(candidate)
  if (!result.success) {
    throw new Error("Feedback summary LLM response is empty")
  }
  return result.data
}
