import { launchOptions as camoufoxLaunchOptions } from "camoufox-js"
import { firefox, type Browser, type Page } from "playwright-core"
import type {
  BrowserFactoryPort,
  BrowserPage,
  BrowserSession,
} from "../../domain/ports/browser-factory.port.js"
import type { Logger } from "../../domain/ports/logger.port.js"

export interface CamoufoxBrowserFactoryConfig {
  headless: boolean
}

class PlaywrightBrowserPage implements BrowserPage {
  constructor(private readonly page: Page) {}

  async goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number },
  ): Promise<void> {
    await this.page.goto(url, {
      waitUntil: options?.waitUntil ?? "domcontentloaded",
      timeout: options?.timeout ?? 60_000,
    })
  }

  async content(): Promise<string> {
    return this.page.content()
  }

  async evaluate<T>(fn: string | (() => T | Promise<T>)): Promise<T> {
    return this.page.evaluate(fn)
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}

class PlaywrightBrowserSession implements BrowserSession {
  constructor(private readonly browser: Browser) {}

  async newPage(): Promise<BrowserPage> {
    const page = await this.browser.newPage()
    return new PlaywrightBrowserPage(page)
  }

  async close(): Promise<void> {
    await this.browser.close()
  }
}

/**
 * Launches Camoufox (anti-detect Firefox) via Playwright.
 */
export class CamoufoxBrowserFactory implements BrowserFactoryPort {
  constructor(
    private readonly config: CamoufoxBrowserFactoryConfig,
    private readonly logger: Logger,
  ) {}

  async launch(options?: { proxyUrl?: string; egressIp?: string }): Promise<BrowserSession> {
    this.logger.debug("Launching Camoufox browser", {
      headless: this.config.headless,
      hasProxy: Boolean(options?.proxyUrl),
      egressIp: options?.egressIp,
    })

    const fromOptions = await camoufoxLaunchOptions({
      headless: this.config.headless,
    })

    if (options?.proxyUrl) {
      fromOptions.proxy = { server: options.proxyUrl }
    }

    const browser = await firefox.launch(fromOptions)
    return new PlaywrightBrowserSession(browser)
  }
}
