import {
  SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
  streamMessageSchema,
  type StreamMessage,
} from "../../domain/events/scrape-shopping-suggestions.event.js"
import type { Logger } from "../../domain/ports/logger.port.js"
import type { ProcessScrapeShoppingSuggestionsUseCase } from "../use-cases/process-scrape-shopping-suggestions.use-case.js"

export interface EventHandler {
  readonly eventName: string
  handle(message: StreamMessage): Promise<void>
}

/**
 * Routes validated stream messages to the matching event handler.
 */
export class EventRouter {
  private readonly handlers = new Map<string, EventHandler>()

  constructor(private readonly logger: Logger) {}

  register(handler: EventHandler): void {
    this.handlers.set(handler.eventName, handler)
  }

  /**
   * Parses raw broker fields into a StreamMessage and dispatches to a handler.
   * Expects fields: `event` (string) and `payload` (JSON string).
   */
  async route(fields: Record<string, string>): Promise<void> {
    const eventName = fields["event"]
    const payloadRaw = fields["payload"]

    if (!eventName || payloadRaw === undefined) {
      throw new Error('Broker message must include "event" and "payload" fields')
    }

    let payloadJson: unknown
    try {
      payloadJson = JSON.parse(payloadRaw) as unknown
    } catch {
      throw new Error("Broker message payload is not valid JSON")
    }

    const parsed = streamMessageSchema.safeParse({
      event: eventName,
      payload: payloadJson,
    })

    if (!parsed.success) {
      throw new Error(`Invalid stream message: ${parsed.error.message}`)
    }

    const handler = this.handlers.get(parsed.data.event)
    if (!handler) {
      this.logger.warn("No handler registered for event", { event: parsed.data.event })
      throw new Error(`No handler registered for event "${parsed.data.event}"`)
    }

    await handler.handle(parsed.data)
  }
}

export class ScrapeShoppingSuggestionsHandler implements EventHandler {
  readonly eventName = SCRAPE_SHOPPING_SUGGESTIONS_EVENT

  constructor(private readonly useCase: ProcessScrapeShoppingSuggestionsUseCase) {}

  async handle(message: StreamMessage): Promise<void> {
    await this.useCase.execute(message.payload)
  }
}
