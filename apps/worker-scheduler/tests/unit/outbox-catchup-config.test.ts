import { describe, it, expect } from "vitest"
import {
  getOutboxCatchupMinAgeMinutes,
  DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES,
} from "../../src/lib/outbox-catchup-config"

describe("getOutboxCatchupMinAgeMinutes", () => {
  it("returns the default when OUTBOX_CATCHUP_MIN_AGE_MINUTES is unset", () => {
    delete process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES
    expect(getOutboxCatchupMinAgeMinutes()).toBe(DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES)
  })

  it("returns the configured value when valid", () => {
    process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES = "30"
    expect(getOutboxCatchupMinAgeMinutes()).toBe(30)
  })

  it("accepts zero as a valid value", () => {
    process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES = "0"
    expect(getOutboxCatchupMinAgeMinutes()).toBe(0)
  })

  it("falls back to the default when OUTBOX_CATCHUP_MIN_AGE_MINUTES is invalid", () => {
    process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES = "-1"
    expect(getOutboxCatchupMinAgeMinutes()).toBe(DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES)

    process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES = "abc"
    expect(getOutboxCatchupMinAgeMinutes()).toBe(DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES)
  })
})
