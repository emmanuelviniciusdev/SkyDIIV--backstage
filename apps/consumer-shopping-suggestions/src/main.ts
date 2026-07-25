import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "./application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "./application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { WebAppCacheAdapter } from "./infrastructure/cache/web-app-cache.adapter.js"
import {
  createWebAppRedisClient,
} from "./infrastructure/cache/redis.js"
import { loadConfig } from "./infrastructure/config/env.js"
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
import { IntervalPullConsumerRunner } from "./presentation/interval-pull-consumer.runner.js"

/**
 * Composition root — wires Clean Architecture layers and starts the consumer.
 *
 * Active broker: Cloudflare Queues (interval HTTP pull) — local and production.
 * Redis Streams adapter (`RedisStreamConsumer` / `StreamConsumerRunner`) remains
 * in the codebase for reference but is not started here.
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
      ? new RoundRobinProxyRotator(config.PROXY_URLS, config.PROXY_EGRESS_IPS)
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

  const runner = new IntervalPullConsumerRunner(
    cfQueues,
    router,
    {
      batchSize: config.CF_QUEUES_BATCH_SIZE,
      intervalMs: config.CF_QUEUES_POLL_INTERVAL_MS,
      concurrency: config.CONSUMER_CONCURRENCY,
    },
    createLogger("cf-queues-runner"),
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

  log.info("Booting consumer-shopping-suggestions", {
    broker: "cloudflare-queues",
    concurrency: config.CONSUMER_CONCURRENCY,
    cfQueuesBatchSize: config.CF_QUEUES_BATCH_SIZE,
    cfQueuesPollIntervalMs: config.CF_QUEUES_POLL_INTERVAL_MS,
    cfQueuesVisibilityTimeoutMs: config.CF_QUEUES_VISIBILITY_TIMEOUT_MS,
    proxyRotation: proxyRotator.isEnabled(),
    proxyCount: config.PROXY_URLS.length,
    webAppRedisConfigured: webAppRedis.isConfigured,
    marketplaces: ["enjoei"],
  })

  await runner.start()
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "ERROR",
      app: "consumer-shopping-suggestions",
      msg: "Fatal startup error",
      error: message,
    }),
  )
  process.exit(1)
})
