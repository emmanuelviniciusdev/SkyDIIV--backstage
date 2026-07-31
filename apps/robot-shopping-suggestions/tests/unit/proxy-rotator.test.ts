import { describe, expect, it } from "vitest"
import {
  DisabledProxyRotator,
  RoundRobinProxyRotator,
} from "../../src/infrastructure/network/proxy-rotator.js"

describe("RoundRobinProxyRotator", () => {
  it("cycles through proxy URLs", () => {
    const rotator = new RoundRobinProxyRotator([
      "socks5://proxy-a.example.com:1080",
      "socks5://proxy-b.example.com:1080",
      "socks5://proxy-c.example.com:1080",
    ])

    expect(rotator.isEnabled()).toBe(true)
    expect(rotator.next()).toEqual({ proxyUrl: "socks5://proxy-a.example.com:1080" })
    expect(rotator.next().proxyUrl).toBe("socks5://proxy-b.example.com:1080")
    expect(rotator.next().proxyUrl).toBe("socks5://proxy-c.example.com:1080")
    expect(rotator.next().proxyUrl).toBe("socks5://proxy-a.example.com:1080")
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
