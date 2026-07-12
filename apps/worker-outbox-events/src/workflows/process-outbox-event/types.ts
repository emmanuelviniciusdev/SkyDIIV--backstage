import { z } from "zod"
import type { OutboxEventRow, TerminalOutboxEventStatus } from "../../lib/db/outbox-events.repository"

export const processOutboxEventPayloadSchema = z.object({
  outboxEventId: z.string().min(1),
})

export type ProcessOutboxEventPayload = z.infer<typeof processOutboxEventPayloadSchema>

export type ProcessOutboxEventSkipReason = "already-processing" | "not-found" | "already-processed"

export type ProcessOutboxEventResult =
  | {
      processed: true
      outboxEventId: string
      flow: string
      event: string
    }
  | {
      processed: false
      reason: ProcessOutboxEventSkipReason
      outboxEventId: string
      status?: TerminalOutboxEventStatus
    }

export type LoadOutboxEventResult =
  | { kind: "ready"; event: OutboxEventRow }
  | { kind: "skip"; reason: "not-found" }
  | { kind: "skip"; reason: "already-processed"; status: TerminalOutboxEventStatus }

export type DispatchOutboxEventResult =
  | { ok: true }
  | { ok: false; error: string }
