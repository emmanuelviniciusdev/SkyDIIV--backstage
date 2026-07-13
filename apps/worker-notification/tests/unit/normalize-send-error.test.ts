import { describe, it, expect } from "vitest"
import { normalizeSendEmailError } from "../../src/workflows/email--welcome/steps/normalize-send-error"

describe("normalizeSendEmailError", () => {
  it("parses a Resend HTTP error with status code and body", () => {
    const error = normalizeSendEmailError(
      new Error('Resend request failed: 422 — {"message":"invalid from"}'),
      "resend",
    )
    expect(error).toEqual({
      code: "provider_request_failed",
      message: 'Resend request failed: 422 — {"message":"invalid from"}',
      provider: "resend",
      status_code: 422,
      response_body: '{"message":"invalid from"}',
    })
  })

  it("maps a missing API key error", () => {
    const error = normalizeSendEmailError(
      new Error("RESEND_API_KEY environment variable is not set"),
      "resend",
    )
    expect(error.code).toBe("missing_api_key")
  })

  it("maps an invalid provider response", () => {
    const error = normalizeSendEmailError(
      new Error("Resend response did not include a message id"),
      "resend",
    )
    expect(error.code).toBe("invalid_provider_response")
  })

  it("falls back to send_failed for unknown errors", () => {
    const error = normalizeSendEmailError(new Error("network down"), "resend")
    expect(error).toEqual({
      code: "send_failed",
      message: "network down",
      provider: "resend",
    })
  })
})
