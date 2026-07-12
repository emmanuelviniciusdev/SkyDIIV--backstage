const PROCESS_OUTBOX_EVENT_PATH = "/process-outbox-event"

function resolveWorkerOutboxEventsUrl(path: string): string {
  const baseUrl = process.env.WORKER_OUTBOX_EVENTS_URL
  if (!baseUrl?.trim()) {
    throw new Error("WORKER_OUTBOX_EVENTS_URL environment variable is not set")
  }
  return new URL(path, baseUrl.trim()).toString()
}

export function resolveProcessOutboxEventUrl(): string {
  return resolveWorkerOutboxEventsUrl(PROCESS_OUTBOX_EVENT_PATH)
}
