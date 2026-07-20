import { describe, expect, it, vi } from "vitest"
import { RandomHumanDelay } from "../../src/infrastructure/scraping/human-delay.js"

describe("RandomHumanDelay", () => {
  it("sleeps within the configured range", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const delay = new RandomHumanDelay({
      minMs: 100,
      maxMs: 200,
      random: () => 0.5,
      sleep,
    })

    await delay.humanDelay()

    expect(sleep).toHaveBeenCalledOnce()
    const ms = sleep.mock.calls[0]![0] as number
    expect(ms).toBeGreaterThanOrEqual(100)
    expect(ms).toBeLessThanOrEqual(200)
  })

  it("uses min when random is 0", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const delay = new RandomHumanDelay({
      minMs: 50,
      maxMs: 150,
      random: () => 0,
      sleep,
    })

    await delay.humanDelay()
    expect(sleep).toHaveBeenCalledWith(50)
  })

  it("uses max when random approaches 1", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const delay = new RandomHumanDelay({
      minMs: 50,
      maxMs: 150,
      random: () => 0.999,
      sleep,
    })

    await delay.humanDelay()
    expect(sleep).toHaveBeenCalledWith(150)
  })
})
