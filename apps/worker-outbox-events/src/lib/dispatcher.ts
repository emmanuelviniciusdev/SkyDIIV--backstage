import { getQStashClient } from "./qstash"
import { publishToCloudflareQueue, resolveCfQueueId } from "./cloudflare-queues"
import { resolveWorkerSyncUrl, resolveWorkerNotificationUrl } from "./downstream-urls"
import type { OutboxEventRow } from "./db/outbox-events.repository"

/**
 * Known broker names — must match `events.broker_name` seeded by the
 * SkyDIIV web app (see `BROKER_NAMES` in `app/lib/outbox.ts`).
 */
export const BROKER_NAMES = {
  QSTASH: "QStash",
  CF_QUEUES: "CF Queues",
} as const

export type BrokerName = (typeof BROKER_NAMES)[keyof typeof BROKER_NAMES]

/**
 * Known outbox routes — each entry is the unique `(event_name, broker_name)`
 * pair from the `events` catalog (see `EVENTS` in `app/lib/outbox.ts`).
 *
 * CF Queues routes declare `queueIdEnv`: each event publishes to its own queue.
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
  SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES: {
    eventName: "scrape-shopping-suggestions",
    brokerName: BROKER_NAMES.CF_QUEUES,
    /** Per-event Cloudflare Queue ID env var. */
    queueIdEnv: "CF_SCRAPE_SHOPP_SUGG_QUEUE_ID",
  },
} as const

export type OutboxRoute = (typeof OUTBOX_ROUTES)[keyof typeof OUTBOX_ROUTES]

/** Composite routing key matching the `events` unique constraint. */
export function outboxRouteKey(eventName: string, brokerName: string): string {
  return `${eventName}::${brokerName}`
}

/**
 * Dispatches the outbox event to the appropriate downstream broker/worker.
 *
 * Routing is by `(event_name, broker_name)` from the `events` catalog (joined
 * onto the outbox row).
 *
 * - **QStash routes** — `payload` forwarded verbatim to the downstream worker URL.
 * - **CF Queues routes** — publishes `{ event, payload }` to the queue ID env
 *   declared on that route (`queueIdEnv`).
 *
 * Throws if the route is unknown or publish fails, so the caller can return
 * a 5xx and let QStash retry.
 */
export async function dispatch(event: OutboxEventRow): Promise<void> {
  const key = outboxRouteKey(event.event_name, event.broker_name)

  switch (key) {
    case outboxRouteKey(
      OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.eventName,
      OUTBOX_ROUTES.LANGUAGE_CHANGED_QSTASH.brokerName,
    ): {
      const client = getQStashClient()
      const url = resolveWorkerSyncUrl("/sync/language")
      await client.publishJSON({ url, body: event.payload })
      break
    }
    case outboxRouteKey(
      OUTBOX_ROUTES.USER_ACCOUNT_CREATED_QSTASH.eventName,
      OUTBOX_ROUTES.USER_ACCOUNT_CREATED_QSTASH.brokerName,
    ): {
      const client = getQStashClient()
      const url = resolveWorkerNotificationUrl("/email--welcome")
      await client.publishJSON({ url, body: event.payload })
      break
    }
    case outboxRouteKey(
      OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.eventName,
      OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.brokerName,
    ): {
      const queueId = resolveCfQueueId(
        OUTBOX_ROUTES.SCRAPE_SHOPPING_SUGGESTIONS_CF_QUEUES.queueIdEnv,
      )
      await publishToCloudflareQueue(
        {
          event: event.event_name,
          payload: event.payload,
        },
        queueId,
      )
      break
    }
    default: {
      throw new Error(
        `Unknown outbox route: event_name=${event.event_name}, broker_name=${event.broker_name}`,
      )
    }
  }
}
