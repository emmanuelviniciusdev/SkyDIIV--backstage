import { describe, it, expect } from "vitest"
import { syncLanguagePayloadSchema } from "../../src/workflows/sync-language/types"

describe("syncLanguagePayloadSchema", () => {
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
})
