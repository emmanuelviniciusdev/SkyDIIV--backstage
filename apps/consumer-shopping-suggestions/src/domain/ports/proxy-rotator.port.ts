/**
 * Selects the next outbound proxy for scrape traffic.
 * Proxy pool is provisioned by infrastructure (Oracle IPv6 + local SOCKS).
 */
export interface ProxyEndpoint {
  /** SOCKS/HTTP proxy URL used by the browser for this session. */
  proxyUrl: string
  /** Public egress IP for Camoufox geoip spoofing (IPv6 from the proxy pool). */
  egressIp?: string
}

export interface ProxyRotatorPort {
  /** Returns true when a proxy pool is configured and active. */
  isEnabled(): boolean

  /** Picks the next proxy (round-robin). */
  next(): ProxyEndpoint
}
