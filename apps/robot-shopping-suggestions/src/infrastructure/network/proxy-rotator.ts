import type { ProxyEndpoint, ProxyRotatorPort } from "../../domain/ports/proxy-rotator.port.js"

/** Round-robin rotator over the proxy URLs configured in PROXY_URLS. */
export class RoundRobinProxyRotator implements ProxyRotatorPort {
  private cursor = 0

  constructor(private readonly proxyUrls: string[]) {
    if (proxyUrls.length === 0) {
      throw new Error("RoundRobinProxyRotator requires at least one proxy URL")
    }
  }

  isEnabled(): boolean {
    return true
  }

  next(): ProxyEndpoint {
    const index = this.cursor % this.proxyUrls.length
    this.cursor += 1
    return { proxyUrl: this.proxyUrls[index]! }
  }
}

/** No-op rotator used when PROXY_URLS is empty. */
export class DisabledProxyRotator implements ProxyRotatorPort {
  isEnabled(): boolean {
    return false
  }

  next(): ProxyEndpoint {
    throw new Error("Proxy rotation is disabled")
  }
}
