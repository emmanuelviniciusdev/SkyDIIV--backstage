/**
 * Routes broker messages to registered event handlers.
 *
 * Wire format (Cloudflare Queues / any broker):
 *   { "event": "<event-name>", "payload": { ... } }
 *
 * Each handler owns validation for its own payload schema. New events =
 * new domain schema + handler registered in `main.ts`.
 */

import {
  SCRAPE_SHOPPING_SUGGESTIONS_EVENT,
  scrapeShoppingSuggestionsPayloadSchema,
} from "../../domain/events/scrape-shopping-suggestions.event.js"
import type { Logger } from "../../domain/ports/logger.port.js"
import type { ProcessScrapeShoppingSuggestionsUseCase } from "../use-cases/process-scrape-shopping-suggestions.use-case.js"

/** Generic broker envelope after JSON decode (before per-event validation). */
export interface BrokerEventMessage {
  event: string
  payload: unknown
}

export interface EventHandler {
  readonly eventName: string
  handle(message: BrokerEventMessage): Promise<void>
}

export class EventRouter {
  private readonly handlers = new Map<string, EventHandler>()

  constructor(private readonly logger: Logger) {}

  register(handler: EventHandler): void {
    this.handlers.set(handler.eventName, handler)
  }

  /**
   * Parses raw broker fields and dispatches to a handler.
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

    const handler = this.handlers.get(eventName)
    if (!handler) {
      this.logger.warn("No handler registered for event", { event: eventName })
      throw new Error(`No handler registered for event "${eventName}"`)
    }

    await handler.handle({ event: eventName, payload: payloadJson })
  }
}

export class ScrapeShoppingSuggestionsHandler implements EventHandler {
  readonly eventName = SCRAPE_SHOPPING_SUGGESTIONS_EVENT

  constructor(private readonly useCase: ProcessScrapeShoppingSuggestionsUseCase) {}

  async handle(message: BrokerEventMessage): Promise<void> {
    const payload = scrapeShoppingSuggestionsPayloadSchema.parse(message.payload)
    await this.useCase.execute(payload)
  }
}
