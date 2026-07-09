/**
 * Minimal structured logger for the worker-outbox-events Cloudflare Worker.
 *
 * Emits newline-delimited JSON to stdout/stderr, captured by
 * Cloudflare Workers Logs (Real-time Logs / Workers Trace Events).
 *
 * Usage:
 *   const log = createLogger("process-outbox-event")
 *   log.info("Event dispatched", { outboxEventId: "abc", flow: "sync-language" })
 *   log.error("Dispatch failed", { error: err.message })
 */

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

const APP = "worker-outbox-events"

function emit(level: Level, msg: string, ctx: Record<string, unknown>): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    app: APP,
    msg,
    ...ctx,
  })
  if (level === "ERROR") console.error(entry)
  else if (level === "WARN") console.warn(entry)
  else console.log(entry)
}

/**
 * Creates a logger pre-scoped to a step/module name.
 * Additional fields can be passed per-call and are merged into the log entry.
 */
export function createLogger(step: string): Logger {
  const base: Record<string, unknown> = { step }
  return {
    debug: (msg, extra) => emit("DEBUG", msg, { ...base, ...extra }),
    info:  (msg, extra) => emit("INFO",  msg, { ...base, ...extra }),
    warn:  (msg, extra) => emit("WARN",  msg, { ...base, ...extra }),
    error: (msg, extra) => emit("ERROR", msg, { ...base, ...extra }),
  }
}
