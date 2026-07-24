import { getQStashClient } from "./qstash"
import { resolveWorkerSyncUrl, resolveWorkerNotificationUrl } from "./downstream-urls"
import type { OutboxEventRow } from "./db/outbox-events.repository"

/**
 * Known broker names — must match `events.broker_name` seeded by the
 * SkyDIIV web app (see `BROKER_NAMES` in `app/lib/outbox.ts`).
 */
export const BROKER_NAMES = {
  QSTASH: "QStash",
} as const

export type BrokerName = (typeof BROKER_NAMES)[keyof typeof BROKER_NAMES]

/**
 * Known outbox routes — each entry is the unique `(event_name, broker_name)`
 * pair from the `events` catalog (see `EVENTS` in `app/lib/outbox.ts`).
 */
export const OUTBOX_ROUTES = {
  LANGUAGE_CHANGED_QSTASH: {
    eventName: "language-changed",
    brokerName: BROKER_NAMES.QSTASH,
  },
  USER_ACCOUNT_CREATED_QSTASH: {
    eventName: "user-account-created",
    brokerName: BROKER_NAMES.QSTASH,
  },
} as const

export type OutboxRoute = (typeof OUTBOX_ROUTES)[keyof typeof OUTBOX_ROUTES]

/** Composite routing key matching the `events` unique constraint. */
export function outboxRouteKey(eventName: string, brokerName: string): string {
  return `${eventName}::${brokerName}`
}

/**
 * Dispatches the outbox event to the appropriate downstream worker via QStash.
 *
 * Routing is by `(event_name, broker_name)` from the `events` catalog (joined
 * onto the outbox row). The event `payload` is forwarded verbatim as the
 * QStash message body — it carries exactly the fields the downstream worker
 * expects.
 *
 * Throws if the route is unknown or QStash publish fails, so the caller can
 * return a 5xx and let QStash retry.
 */
export async function dispatch(event: OutboxEventRow): Promise<void> {
  const client = getQStashClient()
  const key = outboxRouteKey(event.event_name, event.broker_name)

  switch (key) {
    case outboxRouteKey(
      OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.brokerName,
    ): {
      const url = resolveWorkerSyncUrl("/sync/language")
      await client.publishJSON({ url, body: event.payload })
      break
    }
    case outboxRouteKey(
      OUTBOX_ROUTES.USER_ACCOUNT_CREATED_QSTASH.eventName,
      OUTBOX_ROUTES.USER_ACCOUNT_CREATED_QSTASH.brokerName,
    ): {
      const url = resolveWorkerNotificationUrl("/email--welcome")
      await client.publishJSON({ url, body: event.payload })
      break
    }
    default: {
      throw new Error(
        `Unknown outbox route: event_name=${event.event_name}, broker_name=${event.broker_name}`,
      )
    }
  }
}
