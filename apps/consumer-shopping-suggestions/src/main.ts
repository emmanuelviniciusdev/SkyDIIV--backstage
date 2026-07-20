import {
  EventRouter,
  ScrapeShoppingSuggestionsHandler,
} from "./application/services/event-router.js"
import { ProcessScrapeShoppingSuggestionsUseCase } from "./application/use-cases/process-scrape-shopping-suggestions.use-case.js"
import { loadConfig } from "./infrastructure/config/env.js"
import { createLoggerFactory } from "./infrastructure/logging/logger.js"
import { RedisStreamConsumer } from "./infrastructure/messaging/redis-stream.consumer.js"
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
import { StreamConsumerRunner } from "./presentation/stream-consumer.runner.js"

/**
 * Composition root — wires Clean Architecture layers and starts the consumer.
 */
async function main(): Promise<void> {
  const config = loadConfig()
  const createLogger = createLoggerFactory(config.LOG_LEVEL)
  const log = createLogger("main")

  if (config.CAMOUFOX_INSTALL_DIR) {
    process.env.CAMOUFOX_INSTALL_DIR = config.CAMOUFOX_INSTALL_DIR
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
    logger: createLogger("process-scrape"),
  })

  const router = new EventRouter(createLogger("event-router"))
  router.register(new ScrapeShoppingSuggestionsHandler(useCase))

  const broker = new RedisStreamConsumer(
    {
      redisUrl: config.REDIS_URL,
      streamKey: config.REDIS_STREAM_KEY,
      groupName: config.REDIS_CONSUMER_GROUP,
      consumerName: config.REDIS_CONSUMER_NAME,
    },
    createLogger("redis-stream"),
  )

  const runner = new StreamConsumerRunner(
    broker,
    router,
    {
      concurrency: config.CONSUMER_CONCURRENCY,
      blockMs: config.REDIS_BLOCK_MS,
      claimIdleMs: config.REDIS_CLAIM_IDLE_MS,
    },
    createLogger("consumer-runner"),
  )

  const shutdown = async (signal: string) => {
    log.info("Received shutdown signal", { signal })
    await runner.stop()
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))

  log.info("Booting consumer-shopping-suggestions", {
    concurrency: config.CONSUMER_CONCURRENCY,
    stream: config.REDIS_STREAM_KEY,
    proxyRotation: proxyRotator.isEnabled(),
    proxyCount: config.PROXY_URLS.length,
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
