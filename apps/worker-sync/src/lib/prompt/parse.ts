import { z } from "zod"

export function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim()
}

export function parseJsonResponse<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  const cleaned = stripMarkdownFences(raw.trim())

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`${label} response is not valid JSON:\n${cleaned.slice(0, 300)}`)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `${label} response does not match expected schema: ${result.error.message}`,
    )
  }

  return result.data
}
