function resolveWorkerUrl(envVar: string, path: string): string {
  const base = process.env[envVar]?.trim()
  if (!base) throw new Error(`${envVar} environment variable is not set`)
  return new URL(path, base).toString()
}

export function resolveWorkerSyncUrl(path: string): string {
  return resolveWorkerUrl("WORKER_SYNC_URL", path)
}

export function resolveWorkerNotificationUrl(path: string): string {
  return resolveWorkerUrl("WORKER_NOTIFICATION_URL", path)
}

export function resolveWorkerAiWorkflowsUrl(path: string): string {
  return resolveWorkerUrl("WORKER_AI_WORKFLOWS_URL", path)
}
