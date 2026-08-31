import { loadConfig } from "./infrastructure/config/env.js"
import { createSelfDeleteProvider } from "./infrastructure/compute/self-delete.provider.factory.js"
import { closeDbClients, createDbClients } from "./infrastructure/db/client.js"
import { SqlOutboxEventsRepository } from "./infrastructure/db/outbox-events.repository.js"
import { SqlSearchResultsRepository } from "./infrastructure/db/search-results.repository.js"
import { SqlSearchTermsRepository } from "./infrastructure/db/search-terms.repository.js"
import { createLoggerFactory } from "./infrastructure/logging/logger.js"
import { QStashOutboxPublisher } from "./infrastructure/messaging/qstash-outbox.publisher.js"
import {
  DisabledProxyRotator,
  RoundRobinProxyRotator,
} from "./infrastructure/network/proxy-rotator.js"
import { CamoufoxBrowserFactory } from "./infrastructure/scraping/browser.factory.js"
import { RandomHumanDelay } from "./infrastructure/scraping/human-delay.js"
import {
  getMarketplaceScraper,
  listRegisteredMarketplaces,
  registerMarketplaceScraper,
} from "./infrastructure/scraping/marketplace-scraper.provider.js"
import { EnjoeiScraper } from "./infrastructure/scraping/marketplaces/enjoei.scraper.js"
import { ScrapeProductsBatchRunner } from "./presentation/scrape-products-batch.runner.js"

/**
 * Composition root — weekly OCI batch robot for automatic thrifting.
 *
 * Loads unprocessed search terms from Postgres, scrapes marketplaces, persists
 * result rows, enqueues analyze via the outbox, then self-deletes.
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const createLogger = createLoggerFactory(config.LOG_LEVEL)
  const log = createLogger("main")

  if (config.CAMOUFOX_INSTALL_DIR) {
    process.env.CAMOUFOX_INSTALL_DIR = config.CAMOUFOX_INSTALL_DIR
  }

  const db = createDbClients({
    databaseUrl: config.DATABASE_URL,
    databaseUrlUnpooled: config.DATABASE_URL_UNPOOLED,
  })

  const proxyRotator =
    config.PROXY_URLS.length > 0
      ? new RoundRobinProxyRotator(config.PROXY_URLS)
      : new DisabledProxyRotator()

  const browserFactory = new CamoufoxBrowserFactory(
    { headless: config.CAMOUFOX_HEADLESS },
    createLogger("browser-factory"),
  )

  const delay = new RandomHumanDelay({
    minMs: config.SCRAPE_DELAY_MIN_MS,
    maxMs: config.SCRAPE_DELAY_MAX_MS,
  })

  registerMarketplaceScraper(
    "enjoei",
    () =>
      new EnjoeiScraper({
        browserFactory,
        delay,
        proxyRotator,
        logger: createLogger("enjoei-scraper"),
      }),
  )

  const selfDelete = createSelfDeleteProvider({
    provider: config.COMPUTE_PROVIDER,
    logger: createLogger("self-delete"),
    oci: {
      containerInstanceId: config.OCI_CONTAINER_INSTANCE_OCID,
      compartmentId: config.OCI_COMPARTMENT_OCID,
      displayName: config.ROBOT_DISPLAY_NAME,
      region: config.OCI_REGION,
      tenancyOcid: config.OCI_TENANCY_OCID,
      userOcid: config.OCI_USER_OCID,
      fingerprint: config.OCI_FINGERPRINT,
      privateKey: config.OCI_API_PRIVATE_KEY,
      waitForActiveMs: config.SELF_DELETE_WAIT_ACTIVE_MS,
      pollIntervalMs: config.SELF_DELETE_POLL_INTERVAL_MS,
      activeGraceMs: config.SELF_DELETE_ACTIVE_GRACE_MS,
    },
  })

  const runner = new ScrapeProductsBatchRunner({
    searchTermsRepository: new SqlSearchTermsRepository(db.readDb),
    searchResultsRepository: new SqlSearchResultsRepository(db.writeDb),
    outboxRepository: new SqlOutboxEventsRepository(db.writeDb),
    outboxPublisher: new QStashOutboxPublisher({
      qstashToken: config.QSTASH_TOKEN,
      qstashUrl: config.QSTASH_URL,
      workerOutboxEventsUrl: config.WORKER_OUTBOX_EVENTS_URL,
    }),
    resolveScraper: (marketplace) => {
      try {
        return getMarketplaceScraper(marketplace)
      } catch {
        return null
      }
    },
    selfDelete,
    logger: createLogger("scrape-batch"),
    concurrency: config.ROBOT_CONCURRENCY,
  })

  const shutdown = async (signal: string) => {
    log.info("Received shutdown signal", { signal })
    await closeDbClients(db)
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  log.info("Booting robot-scrape-products", {
    mode: "search-terms-batch",
    concurrency: config.ROBOT_CONCURRENCY,
    computeProvider: config.COMPUTE_PROVIDER || "auto",
    proxyRotation: proxyRotator.isEnabled(),
    proxyCount: config.PROXY_URLS.length,
    marketplaces: listRegisteredMarketplaces(),
  })

  try {
    await runner.start()
  } finally {
    await closeDbClients(db)
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "ERROR",
      app: "robot-scrape-products",
      msg: "Fatal startup error",
      error: message,
    }),
  )
  process.exit(1)
})
