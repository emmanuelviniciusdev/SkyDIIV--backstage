import type { Logger } from "../../domain/ports/logger.port.js"
import type {
  PulledQueueMessage,
  QueuePullPort,
} from "../../domain/ports/queue-pull.port.js"

export interface CloudflareQueuesConsumerConfig {
  accountId: string
  queueId: string
  apiToken: string
  /** How long the consumer holds the lease while processing (ms). */
  visibilityTimeoutMs: number
  /** Optional override for tests (default Cloudflare API base). */
  apiBaseUrl?: string
}

/** Minimal fetch signature used by the adapter (injectable for tests). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  },
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}>


interface CloudflarePullMessage {
  id: string
  body: string
  lease_id: string
  attempts?: number
  metadata?: Record<string, string>
}

interface CloudflarePullResponse {
  success?: boolean
  errors?: Array<{ message?: string }>
  result?: {
    message_backlog_count?: number
    messages?: CloudflarePullMessage[]
  }
}

/**
 * Cloudflare Queues HTTP pull consumer.
 *
 * Expects each message body to be JSON:
 * `{ "event": "scrape-shopping-suggestions", "payload": { ... } }`
 *
 * Bodies may arrive base64-encoded when content-type is `json`/`bytes`.
 */
export class CloudflareQueuesConsumer implements QueuePullPort {
  private readonly apiBaseUrl: string

  constructor(
    private readonly config: CloudflareQueuesConsumerConfig,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    this.apiBaseUrl = (config.apiBaseUrl ?? "https://api.cloudflare.com/client/v4").replace(
      /\/$/,
      "",
    )
  }

  async pull(batchSize: number): Promise<PulledQueueMessage[]> {
    const url = `${this.apiBaseUrl}/accounts/${this.config.accountId}/queues/${this.config.queueId}/messages/pull`

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch_size: batchSize,
        visibility_timeout_ms: this.config.visibilityTimeoutMs,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Cloudflare Queues pull failed (${response.status}): ${text}`)
    }

    const body = (await response.json()) as CloudflarePullResponse
    if (body.success === false) {
      const detail = body.errors?.map((e) => e.message).filter(Boolean).join("; ")
      throw new Error(`Cloudflare Queues pull rejected: ${detail || "unknown error"}`)
    }

    const rawMessages = body.result?.messages ?? []
    const parsed: PulledQueueMessage[] = []

    for (const msg of rawMessages) {
      try {
        parsed.push(toPulledMessage(msg))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.logger.error("Skipping malformed Cloudflare Queues message", {
          messageId: msg.id,
          error: message,
        })
      }
    }

    this.logger.info("Cloudflare Queues pull completed", {
      requested: batchSize,
      received: rawMessages.length,
      parsed: parsed.length,
      backlog: body.result?.message_backlog_count ?? null,
    })

    return parsed
  }

  async acknowledge(messages: PulledQueueMessage[]): Promise<void> {
    if (messages.length === 0) return
    await this.postAck({
      acks: messages.map((m) => ({ lease_id: m.leaseId })),
      retries: [],
    })
  }

  async retry(messages: PulledQueueMessage[]): Promise<void> {
    if (messages.length === 0) return
    await this.postAck({
      acks: [],
      retries: messages.map((m) => ({ lease_id: m.leaseId })),
    })
  }

  async disconnect(): Promise<void> {
    // Stateless HTTP client — nothing to close.
  }

  private async postAck(body: {
    acks: Array<{ lease_id: string }>
    retries: Array<{ lease_id: string }>
  }): Promise<void> {
    const url = `${this.apiBaseUrl}/accounts/${this.config.accountId}/queues/${this.config.queueId}/messages/ack`

    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new Error(`Cloudflare Queues ack failed (${response.status}): ${text}`)
    }

    const json = (await response.json()) as CloudflarePullResponse
    if (json.success === false) {
      const detail = json.errors?.map((e) => e.message).filter(Boolean).join("; ")
      throw new Error(`Cloudflare Queues ack rejected: ${detail || "unknown error"}`)
    }
  }
}

function toPulledMessage(msg: CloudflarePullMessage): PulledQueueMessage {
  if (!msg.id || !msg.lease_id) {
    throw new Error("Message is missing id or lease_id")
  }

  const decoded = decodeMessageBody(msg.body, msg.metadata)
  const fields = streamFieldsFromBody(decoded)

  return {
    id: msg.id,
    leaseId: msg.lease_id,
    fields,
  }
}

function decodeMessageBody(
  body: string,
  metadata: Record<string, string> | undefined,
): unknown {
  const contentType = metadata?.["CF-Content-Type"] ?? metadata?.["cf-content-type"]

  // Try plain JSON first (common when published as text/json string).
  const asJson = tryParseJson(body)
  if (asJson !== undefined) return asJson

  // Cloudflare may base64-encode json/bytes payloads.
  if (contentType === "json" || contentType === "bytes" || looksLikeBase64(body)) {
    try {
      const decoded = Buffer.from(body, "base64").toString("utf8")
      const parsed = tryParseJson(decoded)
      if (parsed !== undefined) return parsed
      return decoded
    } catch {
      // fall through
    }
  }

  throw new Error("Message body is not valid JSON")
}

function streamFieldsFromBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error('Message body must be an object with "event" and "payload"')
  }

  const record = body as Record<string, unknown>
  const event = record["event"]
  const payload = record["payload"]

  if (typeof event !== "string" || event.length === 0) {
    throw new Error('Message body is missing string "event"')
  }
  if (payload === undefined) {
    throw new Error('Message body is missing "payload"')
  }

  return {
    event,
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function looksLikeBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+=*$/.test(value) && value.length % 4 === 0 && value.length >= 8
}
