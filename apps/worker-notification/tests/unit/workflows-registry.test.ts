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
  it("exposes the email--welcome endpoint key (last path segment of /email--welcome)", () => {
    expect(Object.keys(workflowRegistry)).toContain("email--welcome")
  })

  it("uses a key that matches the outbox flow name written by the web app", () => {
    // Must equal OUTBOX_FLOWS.EMAIL_WELCOME in worker-outbox-events / web app.
    expect(Object.keys(workflowRegistry)).toEqual(["email--welcome"])
  })

  it("uses workflow keys without slashes (serveMany routes by last path segment)", () => {
    for (const key of Object.keys(workflowRegistry)) {
      expect(key).not.toContain("/")
    }
  })
})

describe("workflowsFetch", () => {
  it("passes WORKER_NOTIFICATION_URL as serveMany baseUrl", async () => {
    const request = new Request("https://worker-notification.workers.dev/email--welcome", {
      method: "POST",
    })
    const env = {
      WORKER_NOTIFICATION_URL: "https://worker-notification.example.workers.dev",
    }

    await workflowsFetch(request, env)

    expect(state.mockServeMany).toHaveBeenCalledOnce()
    expect(state.mockServeMany).toHaveBeenCalledWith(workflowRegistry, {
      baseUrl: "https://worker-notification.example.workers.dev",
    })
    expect(state.mockFetch).toHaveBeenCalledWith(request, env)
  })

  it("throws when WORKER_NOTIFICATION_URL is missing", () => {
    const request = new Request("https://worker-notification.workers.dev/email--welcome", {
      method: "POST",
    })

    expect(() => workflowsFetch(request, {})).toThrow(
      "WORKER_NOTIFICATION_URL environment variable is not set",
    )
  })
})
