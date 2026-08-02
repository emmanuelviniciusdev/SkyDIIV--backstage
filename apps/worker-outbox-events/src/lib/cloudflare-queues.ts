/**
 * Publishes JSON message(s) to a Cloudflare Queue via the HTTP API.
 *
 * Each CF Queues outbox event targets its own queue ID (env var resolved by
 * the dispatcher). Envelope: `{ event, payload }` inside each message `body`.
 *
 * Prefer {@link publishBatchToCloudflareQueue} (`POST .../messages/batch`).
 * {@link publishToCloudflareQueue} is a thin wrapper around a single-message batch.
 *
 * @see https://developers.cloudflare.com/queues/configuration/pull-consumers/#send
 * @see https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/bulk_push/
 */

export interface CloudflareQueueMessage {
  event: string
  payload: Record<string, unknown>
}

interface CloudflareQueuesApiResponse {
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} environment variable is not set`)
  return value
}

/** Resolves a per-event type Cloudflare Queue ID from an environment variable. */
export function resolveCfQueueId(envVar: string): string {
  return requireEnv(envVar)
}

/**
 * POSTs one or more messages to the given Cloudflare Queue via the batch API.
 * Throws when credentials are missing, the message list is empty, or the API reports failure.
 */
export async function publishBatchToCloudflareQueue(
  messages: CloudflareQueueMessage[],
  queueId: string,
): Promise<void> {
  if (messages.length === 0) {
    throw new Error("Cloudflare Queues batch publish requires at least one message")
  }

  const trimmedQueueId = queueId.trim()
  if (!trimmedQueueId) {
    throw new Error("Cloudflare queue ID must be a non-empty string")
  }

  const accountId = requireEnv("CF_ACCOUNT_ID")
  const token = requireEnv("CF_QUEUES_API_TOKEN")

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${trimmedQueueId}/messages/batch`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: messages.map((body) => ({
        body,
        content_type: "json",
      })),
    }),
  })

  const text = await response.text()
  let parsed: CloudflareQueuesApiResponse | null = null
  try {
    parsed = text ? (JSON.parse(text) as CloudflareQueuesApiResponse) : null
  } catch {
    // Non-JSON body — fall through with parsed left as null.
  }

  if (!response.ok || parsed?.success === false) {
    const apiErrors = parsed?.errors?.map((e) => e.message).filter(Boolean).join("; ")
    throw new Error(
      `Cloudflare Queues batch publish failed (${response.status}): ${apiErrors || text || response.statusText}`,
    )
  }
}

/**
 * POSTs one message via the batch API (single-element batch).
 * Prefer {@link publishBatchToCloudflareQueue} when publishing multiple messages.
 */
export async function publishToCloudflareQueue(
  message: CloudflareQueueMessage,
  queueId: string,
): Promise<void> {
  await publishBatchToCloudflareQueue([message], queueId)
}
