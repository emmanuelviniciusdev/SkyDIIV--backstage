/**
 * Selects the next outbound proxy for scrape traffic.
 * Proxies are external and configured through PROXY_URLS.
 */
export interface ProxyEndpoint {
  /** SOCKS/HTTP proxy URL used by the browser for this session. */
  proxyUrl: string
}

export interface ProxyRotatorPort {
  /** Returns true when a proxy pool is configured and active. */
  isEnabled(): boolean

  /** Picks the next proxy (round-robin). */
  next(): ProxyEndpoint
}
