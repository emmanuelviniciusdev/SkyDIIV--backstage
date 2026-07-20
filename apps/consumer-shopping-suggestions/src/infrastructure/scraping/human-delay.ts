import type { DelayPort } from "../../domain/ports/delay.port.js"

export interface RandomDelayConfig {
  minMs: number
  maxMs: number
  /** Injectable RNG for tests — defaults to Math.random. */
  random?: () => number
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits a random duration in [minMs, maxMs] to mimic human browsing pauses.
 */
export class RandomHumanDelay implements DelayPort {
  private readonly random: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly config: RandomDelayConfig) {
    this.random = config.random ?? Math.random
    this.sleep = config.sleep ?? defaultSleep
  }

  async humanDelay(): Promise<void> {
    const { minMs, maxMs } = this.config
    const span = maxMs - minMs
    const ms = minMs + Math.floor(this.random() * (span + 1))
    await this.sleep(ms)
  }
}
