import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { getNeonConfig } from "../../src/lib/neon/config"

describe("getNeonConfig", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("returns trimmed Neon credentials when all env vars are set", () => {
    process.env.NEON_API_KEY = "  key  "
    process.env.NEON_PROJECT_ID = " proj-1 "
    process.env.NEON_BRANCH_ID = "branch-main"

    expect(getNeonConfig()).toEqual({
      apiKey: "key",
      projectId: "proj-1",
      branchId: "branch-main",
    })
  })

  it("throws when NEON_API_KEY is missing", () => {
    delete process.env.NEON_API_KEY
    process.env.NEON_PROJECT_ID = "proj-1"
    process.env.NEON_BRANCH_ID = "branch-main"

    expect(() => getNeonConfig()).toThrow("NEON_API_KEY environment variable is not set")
  })
})
