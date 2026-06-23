import { describe, it, expect } from "vitest"
import {
  syncLanguagePayloadSchema,
  syncUserLanguageStep,
} from "../../src/workflows/sync-language/steps/sync-user-language"

describe("sync-language step", () => {
  const validPayload = {
    userid: "user-123",
    old_language: "en-US",
    new_language: "pt-BR",
  }

  it("validates a well-formed payload", () => {
    const parsed = syncLanguagePayloadSchema.safeParse(validPayload)
    expect(parsed.success).toBe(true)
  })

  it("rejects payloads missing required fields", () => {
    const parsed = syncLanguagePayloadSchema.safeParse({ userid: "user-123" })
    expect(parsed.success).toBe(false)
  })

  it("returns the payload fields from the boilerplate step", () => {
    const result = syncUserLanguageStep(validPayload)
    expect(result).toEqual(validPayload)
  })
})
