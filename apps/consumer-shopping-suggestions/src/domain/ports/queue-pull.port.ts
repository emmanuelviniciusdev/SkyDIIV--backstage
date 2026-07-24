/**
 * A message pulled from an HTTP pull-based queue (e.g. Cloudflare Queues).
 * `fields` match the EventRouter contract (`event` + JSON `payload` string).
 */
export interface PulledQueueMessage {
  id: string
  leaseId: string
  fields: Record<string, string>
}

/**
 * Port for interval-based pull consumers (Cloudflare Queues HTTP pull, etc.).
 * Distinct from {@link MessageBrokerPort} (Redis Streams continuous XREADGROUP).
 */
export interface QueuePullPort {
  /**
   * Pulls up to `batchSize` messages. Returns immediately (short-poll) when empty.
   */
  pull(batchSize: number): Promise<PulledQueueMessage[]>

  /**
   * Acknowledges successful processing so messages are removed from the queue.
   */
  acknowledge(messages: PulledQueueMessage[]): Promise<void>

  /**
   * Marks messages for immediate redelivery (optional retry path).
   */
  retry(messages: PulledQueueMessage[]): Promise<void>

  /**
   * Graceful shutdown of any client resources.
   */
  disconnect(): Promise<void>
}
