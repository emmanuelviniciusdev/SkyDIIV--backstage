export interface NeonConfig {
  apiKey: string
  projectId: string
  branchId: string
}

/**
 * Reads Neon Management API credentials from the environment.
 * Required for the neon-database-snapshot flow.
 */
export function getNeonConfig(): NeonConfig {
  const apiKey = process.env.NEON_API_KEY?.trim()
  const projectId = process.env.NEON_PROJECT_ID?.trim()
  const branchId = process.env.NEON_BRANCH_ID?.trim()

  if (!apiKey) throw new Error("NEON_API_KEY environment variable is not set")
  if (!projectId) throw new Error("NEON_PROJECT_ID environment variable is not set")
  if (!branchId) throw new Error("NEON_BRANCH_ID environment variable is not set")

  return { apiKey, projectId, branchId }
}
