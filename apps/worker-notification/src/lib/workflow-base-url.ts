export const WORKFLOW_BASE_URL_ENV = "WORKER_NOTIFICATION_URL"

export function resolveWorkflowBaseUrl(env: Record<string, string | undefined>): string {
  const baseUrl = env[WORKFLOW_BASE_URL_ENV]?.trim()
  if (!baseUrl) {
    throw new Error(`${WORKFLOW_BASE_URL_ENV} environment variable is not set`)
  }
  return baseUrl
}
