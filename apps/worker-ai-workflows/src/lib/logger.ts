/**
 * Structured logger for the worker-ai-workflows Cloudflare Worker.
 *
 * When a request is wrapped with `withRequestTelemetry`, logs go through the
 * selected ObservabilityPort (Grafana Cloud dual-writes OTLP + console NDJSON;
 * noop writes console only). Outside a request, logs fall back to console NDJSON.
 *
 * Usage:
 *   const log = createLogger("build-prompt", userId)
 *   log.info("Preferences loaded", { location, preferencesId })
 *   log.error("DB error", { error: err.message })
 */

import type { Logger } from "../domain/ports/logger.port"
import { createConsoleLogger } from "../infrastructure/observability/console-ndjson"
import { getRequestObservability } from "../infrastructure/observability/observability-context"

export type { Logger } from "../domain/ports/logger.port"

const APP = "worker-ai-workflows"

/**
 * Creates a logger pre-scoped to a step/module name and optional userId.
 * Additional fields can be passed per-call and are merged into the log entry.
 */
export function createLogger(step: string, userId?: string): Logger {
  const context = userId ? { userId } : undefined
  const observability = getRequestObservability()
  if (observability) return observability.logger(step, context)
  return createConsoleLogger(APP, step, context)
}
