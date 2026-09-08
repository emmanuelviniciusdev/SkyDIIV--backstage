/**
 * Reads a positive integer from process.env. Unset, empty, non-integer, or
 * non-positive values return `fallback`.
 */
export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() ?? ""
  if (raw === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}
