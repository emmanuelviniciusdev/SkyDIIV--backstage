import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "./application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "./application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { WebAppCacheAdapter } from "./infrastructure/cache/web-app-cache.adapter.js"
import { createWebAppRedisClient } from "./infrastructure/cache/redis.js"
import { loadConfig } from "./infrastructure/config/env.js"
import { createSelfDeleteProvider } from "./infrastructure/compute/self-delete.provider.factory.js"
import { closeDbClients, createDbClients } from "./infrastructure/db/client.js"
import { SqlScrapedProductsRepository } from "./infrastructure/db/scraped-products.repository.js"
import { SqlWardrobePanoramaRepository } from "./infrastructure/db/wardrobe-panorama.repository.js"
import { createLoggerFactory } from "./infrastructure/logging/logger.js"
import { CloudflareQueuesConsumer } from "./infrastructure/messaging/cloudflare-queues.consumer.js"
import {
  DisabledProxyRotator,
  RoundRobinProxyRotator,
} from "./infrastructure/network/proxy-rotator.js"
import { CamoufoxBrowserFactory } from "./infrastructure/scraping/browser.factory.js"
import { RandomHumanDelay } from "./infrastructure/scraping/human-delay.js"
import {
  getMarketplaceScraper,
  registerMarketplaceScraper,
} from "./infrastructure/scraping/marketplace-scraper.provider.js"
import { EnjoeiScraper } from "./infrastructure/scraping/marketplaces/enjoei.scraper.js"
import { BatchDrainRunner } from "./presentation/batch-drain.runner.js"

/**
 * Composition root — wires Clean Architecture layers and starts the CRON robot.
 *
 * Mode: drain Cloudflare Queues (2 at a time) until empty, then self-delete
 * via the configured compute provider (provider pattern).
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

  const webAppRedis = createWebAppRedisClient({
    webAppRedisRestUrl: config.WEB_APP_REDIS_REST_URL,
    webAppRedisRestToken: config.WEB_APP_REDIS_REST_TOKEN,
    webAppRedisUrl: config.WEB_APP_REDIS_URL,
  })
  if (!webAppRedis.isConfigured) {
    log.warn(
      "Web-app Redis not configured — shopping-suggestions cache invalidation and notifications will be skipped",
    )
  }

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

  const useCase = new ProcessScrapeShoppingSuggestionsUseCase({
    resolveScraper: getMarketplaceScraper,
    wardrobePanoramaRepository: new SqlWardrobePanoramaRepository(db.readDb),
    scrapedProductsRepository: new SqlScrapedProductsRepository(
      db.readDb,
      db.writeDb,
      createLogger("scraped-products-repo"),
    ),
    cache: new WebAppCacheAdapter(webAppRedis, createLogger("web-cache")),
    logger: createLogger("process-scrape"),
  })

  const router = new EventRouter(createLogger("event-router"))
  router.register(new ScrapeShoppingSuggestionsHandler(useCase))

  const cfQueues = new CloudflareQueuesConsumer(
    {
      accountId: config.CF_ACCOUNT_ID,
      queueId: config.CF_SCRAPE_SHOPP_SUGG_QUEUE_ID,
      apiToken: config.CF_QUEUES_API_TOKEN,
      visibilityTimeoutMs: config.CF_QUEUES_VISIBILITY_TIMEOUT_MS,
    },
    createLogger("cf-queues"),
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

  const runner = new BatchDrainRunner(
    cfQueues,
    router,
    selfDelete,
    {
      batchSize: config.CF_QUEUES_BATCH_SIZE,
      concurrency: config.ROBOT_CONCURRENCY,
    },
    createLogger("batch-drain"),
  )

  const shutdown = async (signal: string) => {
    log.info("Received shutdown signal", { signal })
    await runner.stop()
    await webAppRedis.close?.()
    await closeDbClients(db)
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  log.info("Booting robot-shopping-suggestions", {
    mode: "batch-drain-cron",
    broker: "cloudflare-queues",
    concurrency: config.ROBOT_CONCURRENCY,
    cfQueuesBatchSize: config.CF_QUEUES_BATCH_SIZE,
    cfQueuesVisibilityTimeoutMs: config.CF_QUEUES_VISIBILITY_TIMEOUT_MS,
    computeProvider: config.COMPUTE_PROVIDER || "auto",
    proxyRotation: proxyRotator.isEnabled(),
    proxyCount: config.PROXY_URLS.length,
    webAppRedisConfigured: webAppRedis.isConfigured,
    marketplaces: ["enjoei"],
  })

  try {
    await runner.start()
  } finally {
    await webAppRedis.close?.()
    await closeDbClients(db)
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "ERROR",
      app: "robot-shopping-suggestions",
      msg: "Fatal startup error",
      error: message,
    }),
  )
  process.exit(1)
})
