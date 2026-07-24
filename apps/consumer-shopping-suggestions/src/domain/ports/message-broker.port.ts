/**
 * A raw message pulled from the message broker before domain validation.
 */
export interface BrokerMessage {
  id: string
  fields: Record<string, string>
}

/**
 * Port for continuous stream brokers (Redis Streams XREADGROUP).
 * For interval HTTP pull brokers (Cloudflare Queues), see queue-pull.port.ts.
 */
export interface MessageBrokerPort {
  /**
   * Ensures the consumer group exists (idempotent).
   */
  ensureConsumerGroup(): Promise<void>

  /**
   * Reads up to `count` pending/new messages for this consumer.
   * Blocks for up to `blockMs` when the stream is empty.
   */
  readMessages(count: number, blockMs: number): Promise<BrokerMessage[]>

  /**
   * Acknowledges successful processing of a message.
   */
  acknowledge(messageId: string): Promise<void>

  /**
   * Claims idle pending messages that exceeded the idle threshold (recovery).
   */
  claimIdleMessages(count: number, minIdleMs: number): Promise<BrokerMessage[]>

  /**
   * Graceful shutdown of broker connections.
   */
  disconnect(): Promise<void>
}
