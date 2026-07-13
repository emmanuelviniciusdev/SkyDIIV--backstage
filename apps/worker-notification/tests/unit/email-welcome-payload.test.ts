import { describe, it, expect } from "vitest"
import { emailWelcomePayloadSchema } from "../../src/workflows/email--welcome/types"

describe("emailWelcomePayloadSchema", () => {
  it("accepts the outbox payload shape", () => {
    const result = emailWelcomePayloadSchema.safeParse({
      user_id: "11111111-1111-1111-1111-111111111111",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    })
    expect(result.success).toBe(true)
  })

  it("allows a missing last_name and first_name", () => {
    const result = emailWelcomePayloadSchema.safeParse({
      user_id: "user-1",
      email: "jane@example.com",
    })
    expect(result.success).toBe(true)
  })

  it("rejects a missing user_id", () => {
    const result = emailWelcomePayloadSchema.safeParse({ email: "jane@example.com" })
    expect(result.success).toBe(false)
  })

  it("rejects an invalid email", () => {
    const result = emailWelcomePayloadSchema.safeParse({
      user_id: "user-1",
      email: "not-an-email",
    })
    expect(result.success).toBe(false)
  })
})
