import { describe, it, expect, vi } from "vitest"

const state = vi.hoisted(() => {
  const captured = {
    registry: null as Record<string, unknown> | null,
    options: null as { baseUrl?: string } | null,
  }
  return {
    captured,
    mockFetch: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    mockServeMany: vi.fn(
      (workflows: Record<string, unknown>, options?: { baseUrl?: string }) => {
        captured.registry = workflows
        captured.options = options ?? null
        return { fetch: state.mockFetch }
      },
    ),
    mockCreateWorkflow: vi.fn(() => ({ __workflow: true })),
  }
})

vi.mock("@upstash/workflow/cloudflare", () => ({
  serveMany: state.mockServeMany,
  createWorkflow: state.mockCreateWorkflow,
}))

import { workflowRegistry, workflowsFetch } from "../../src/workflows/index"

describe("workflows registry", () => {
  it("exposes the sync-language endpoint key (last path segment of /sync/language)", () => {
    expect(Object.keys(workflowRegistry)).toContain("language")
  })

  it("uses workflow keys without slashes (serveMany routes by last path segment)", () => {
    for (const key of Object.keys(workflowRegistry)) {
      expect(key).not.toContain("/")
    }
  })
})

describe("workflowsFetch", () => {
  it("passes WORKER_SYNC_URL as serveMany baseUrl", async () => {
    const request = new Request("https://worker-sync.workers.dev/sync/language", {
      method: "POST",
    })
    const env = {
      WORKER_SYNC_URL: "https://worker-sync.example.workers.dev",
    }

    await workflowsFetch(request, env)

    expect(state.mockServeMany).toHaveBeenCalledOnce()
    expect(state.mockServeMany).toHaveBeenCalledWith(workflowRegistry, {
      baseUrl: "https://worker-sync.example.workers.dev",
    })
    expect(state.mockFetch).toHaveBeenCalledWith(request, env)
  })

  it("throws when WORKER_SYNC_URL is missing", () => {
    const request = new Request("https://worker-sync.workers.dev/sync/language", {
      method: "POST",
    })

    expect(() => workflowsFetch(request, {})).toThrow(
      "WORKER_SYNC_URL environment variable is not set",
    )
  })
})
