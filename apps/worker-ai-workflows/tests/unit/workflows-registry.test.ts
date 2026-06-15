import { describe, it, expect, vi } from "vitest"

/**
 * Unit test for the serveMany workflow registry.
 * Mocks @upstash/workflow/cloudflare so the registry can be inspected without
 * constructing real Upstash workflows.
 */

const state = vi.hoisted(() => {
  const captured = { registry: null as Record<string, unknown> | null }
  return {
    captured,
    mockServeMany: vi.fn((workflows: Record<string, unknown>) => {
      captured.registry = workflows
      return { fetch: vi.fn() }
    }),
    mockCreateWorkflow: vi.fn(() => ({ __workflow: true })),
  }
})

vi.mock("@upstash/workflow/cloudflare", () => ({
  serveMany: state.mockServeMany,
  createWorkflow: state.mockCreateWorkflow,
}))

import "../../src/workflows/index"

describe("workflows registry", () => {
  it("registers exactly one serveMany router", () => {
    expect(state.mockServeMany).toHaveBeenCalledOnce()
  })

  it("exposes the generate-weekly-outfits endpoint key", () => {
    expect(state.captured.registry).not.toBeNull()
    expect(Object.keys(state.captured.registry ?? {})).toContain("generate-weekly-outfits")
  })

  it("uses workflow keys without slashes (serveMany routes by last path segment)", () => {
    for (const key of Object.keys(state.captured.registry ?? {})) {
      expect(key).not.toContain("/")
    }
  })
})
