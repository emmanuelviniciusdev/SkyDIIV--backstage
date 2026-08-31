export interface OutboxPublisherPort {
  publishProcessOutboxEvent(outboxEventIds: string[]): Promise<void>
}

export class QStashOutboxPublisher implements OutboxPublisherPort {
  constructor(
    private readonly env: {
      qstashToken: string
      qstashUrl?: string
      workerOutboxEventsUrl: string
    },
  ) {}

  async publishProcessOutboxEvent(outboxEventIds: string[]): Promise<void> {
    if (outboxEventIds.length === 0) return

    const origin = (this.env.qstashUrl ?? "https://qstash.upstash.io").replace(/\/$/, "")
    const destination = new URL("/process-outbox-event", `${this.env.workerOutboxEventsUrl}/`).toString()

    const response = await fetch(`${origin}/v2/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.qstashToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        outboxEventIds.map((outboxEventId) => ({
          destination,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outboxEventId }),
        })),
      ),
    })

    if (!response.ok) {
      throw new Error(`QStash batch publish failed (${response.status})`)
    }
  }
}
