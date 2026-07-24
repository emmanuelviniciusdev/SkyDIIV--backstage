/**
 * Publishes a JSON message to a Cloudflare Queue via the HTTP API.
 *
 * Each CF Queues outbox event targets its own queue ID (env var resolved by
 * the dispatcher). Envelope: `{ event, payload }` inside the message `body`.
 *
 * @see https://developers.cloudflare.com/queues/examples/publish-to-a-queue-via-http/
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
 * POSTs one message to the given Cloudflare Queue.
 * Throws when credentials are missing or the API reports failure.
 */
export async function publishToCloudflareQueue(
  message: CloudflareQueueMessage,
  queueId: string,
): Promise<void> {
  const trimmedQueueId = queueId.trim()
  if (!trimmedQueueId) {
    throw new Error("Cloudflare queue ID must be a non-empty string")
  }

  const accountId = requireEnv("CF_ACCOUNT_ID")
  const token = requireEnv("CF_QUEUES_API_TOKEN")

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${trimmedQueueId}/messages`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: message,
      content_type: "json",
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
      `Cloudflare Queues publish failed (${response.status}): ${apiErrors || text || response.statusText}`,
    )
  }
}
