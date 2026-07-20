/**
 * Human-like delay between scrape requests to reduce bot detection risk.
 */
export interface DelayPort {
  /**
   * Waits a random duration within the configured min/max range.
   */
  humanDelay(): Promise<void>
}
