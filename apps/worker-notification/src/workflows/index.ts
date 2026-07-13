import { serveMany } from "@upstash/workflow/cloudflare"
import { resolveWorkflowBaseUrl } from "../lib/workflow-base-url"
import { emailWelcomeWorkflow } from "./email--welcome/workflow"

/**
 * Workflow registry for the worker-notification worker.
 *
 * `serveMany` hosts multiple Upstash Workflows on a single Cloudflare Worker and
 * routes each request by the LAST path segment of its URL. The map key becomes
 * the public endpoint suffix and is preserved across QStash step callbacks:
 *
 *   key "email--welcome"  →  POST /email--welcome
 *
 * The key matches the outbox `flow` value the SkyDIIV web app writes on user
 * registration, so `worker-outbox-events` can dispatch to it directly.
 *
 * Callback base URL comes from WORKER_NOTIFICATION_URL (passed as serveMany `baseUrl`).
 *
 * Note: workflow keys cannot contain "/".
 */
export const workflowRegistry = {
  "email--welcome": emailWelcomeWorkflow,
} as const

let cachedBaseUrl: string | undefined
let cachedFetch: ReturnType<typeof serveMany>["fetch"] | undefined

/**
 * Dispatches a request to the matching workflow. `serveMany` types its handler
 * as `Promise<any>`; we narrow it to `Promise<Response>` for the caller.
 */
export function workflowsFetch(
  request: Request,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const baseUrl = resolveWorkflowBaseUrl(env)

  if (cachedBaseUrl !== baseUrl || !cachedFetch) {
    cachedBaseUrl = baseUrl
    cachedFetch = serveMany(workflowRegistry, { baseUrl }).fetch
  }

  return cachedFetch(request, env) as Promise<Response>
}
