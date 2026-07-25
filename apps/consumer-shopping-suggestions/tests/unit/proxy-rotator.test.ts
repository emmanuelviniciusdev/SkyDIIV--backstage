import { describe, expect, it } from "vitest"
import {
  DisabledProxyRotator,
  RoundRobinProxyRotator,
} from "../../src/infrastructure/network/proxy-rotator.js"

describe("RoundRobinProxyRotator", () => {
  it("cycles through proxy URLs with aligned egress IPs", () => {
    const rotator = new RoundRobinProxyRotator(
      [
        "socks5://127.0.0.1:11080",
        "socks5://127.0.0.1:11081",
        "socks5://127.0.0.1:11082",
      ],
      [
        "2603:c020:4016:ba00:0:9156:4a06:9403",
        "2603:c020:4016:ba00:0:508d:77f0:a204",
        "2603:c020:4016:ba00:0:5f3a:d274:7c03",
      ],
    )

    expect(rotator.isEnabled()).toBe(true)
    expect(rotator.next()).toEqual({
      proxyUrl: "socks5://127.0.0.1:11080",
      egressIp: "2603:c020:4016:ba00:0:9156:4a06:9403",
    })
    expect(rotator.next().proxyUrl).toBe("socks5://127.0.0.1:11081")
    expect(rotator.next().proxyUrl).toBe("socks5://127.0.0.1:11082")
    expect(rotator.next().proxyUrl).toBe("socks5://127.0.0.1:11080")
  })

  it("rejects an empty proxy list", () => {
    expect(() => new RoundRobinProxyRotator([])).toThrow(/at least one/)
  })
})

describe("DisabledProxyRotator", () => {
  it("reports disabled and rejects next()", () => {
    const rotator = new DisabledProxyRotator()
    expect(rotator.isEnabled()).toBe(false)
    expect(() => rotator.next()).toThrow(/disabled/)
  })
})
