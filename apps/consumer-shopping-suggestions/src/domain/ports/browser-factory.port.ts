/**
 * Launches and manages anti-detect browser instances for scraping.
 */
export interface BrowserSession {
  newPage(): Promise<BrowserPage>
  close(): Promise<void>
}

export interface BrowserPage {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<void>
  content(): Promise<string>
  evaluate<T>(fn: string | (() => T | Promise<T>)): Promise<T>
  close(): Promise<void>
}

export interface BrowserFactoryPort {
  /**
   * Launches a new browser session, optionally bound to a rotated network endpoint.
   */
  launch(options?: { proxyUrl?: string; egressIp?: string }): Promise<BrowserSession>
}
