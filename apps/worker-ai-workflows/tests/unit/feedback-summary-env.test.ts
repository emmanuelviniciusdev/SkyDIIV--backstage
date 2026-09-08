import { describe, it, expect, afterEach } from "vitest"
import {
  DEFAULT_FEEDBACK_SUMMARY_CHUNK_SIZE,
  DEFAULT_FEEDBACK_SUMMARY_MAX_ENTRIES,
  FEEDBACK_SUMMARY_CHUNK_SIZE_ENV,
  FEEDBACK_SUMMARY_MAX_ENTRIES_ENV,
  resolveFeedbackSummaryChunkSize,
  resolveFeedbackSummaryMaxEntries,
} from "../../src/lib/automatic-thrifting/feedback-summary-env"

const ENV_KEYS = [FEEDBACK_SUMMARY_CHUNK_SIZE_ENV, FEEDBACK_SUMMARY_MAX_ENTRIES_ENV] as const

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

describe("resolveFeedbackSummaryChunkSize", () => {
  it("defaults to 50 when unset", () => {
    delete process.env[FEEDBACK_SUMMARY_CHUNK_SIZE_ENV]
    expect(resolveFeedbackSummaryChunkSize()).toBe(DEFAULT_FEEDBACK_SUMMARY_CHUNK_SIZE)
  })

  it("parses a valid positive integer", () => {
    process.env[FEEDBACK_SUMMARY_CHUNK_SIZE_ENV] = "10"
    expect(resolveFeedbackSummaryChunkSize()).toBe(10)
  })

  it("falls back on zero", () => {
    process.env[FEEDBACK_SUMMARY_CHUNK_SIZE_ENV] = "0"
    expect(resolveFeedbackSummaryChunkSize()).toBe(DEFAULT_FEEDBACK_SUMMARY_CHUNK_SIZE)
  })

  it("falls back on non-numeric values", () => {
    process.env[FEEDBACK_SUMMARY_CHUNK_SIZE_ENV] = "abc"
    expect(resolveFeedbackSummaryChunkSize()).toBe(DEFAULT_FEEDBACK_SUMMARY_CHUNK_SIZE)
  })
})

describe("resolveFeedbackSummaryMaxEntries", () => {
  it("defaults to 250 when unset", () => {
    delete process.env[FEEDBACK_SUMMARY_MAX_ENTRIES_ENV]
    expect(resolveFeedbackSummaryMaxEntries()).toBe(DEFAULT_FEEDBACK_SUMMARY_MAX_ENTRIES)
  })

  it("parses a valid positive integer", () => {
    process.env[FEEDBACK_SUMMARY_MAX_ENTRIES_ENV] = "100"
    expect(resolveFeedbackSummaryMaxEntries()).toBe(100)
  })

  it("falls back on zero", () => {
    process.env[FEEDBACK_SUMMARY_MAX_ENTRIES_ENV] = "0"
    expect(resolveFeedbackSummaryMaxEntries()).toBe(DEFAULT_FEEDBACK_SUMMARY_MAX_ENTRIES)
  })

  it("falls back on non-numeric values", () => {
    process.env[FEEDBACK_SUMMARY_MAX_ENTRIES_ENV] = "abc"
    expect(resolveFeedbackSummaryMaxEntries()).toBe(DEFAULT_FEEDBACK_SUMMARY_MAX_ENTRIES)
  })
})
