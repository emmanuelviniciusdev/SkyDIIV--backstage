/**
 * Minimal structured logger for the worker-notification Cloudflare Worker.
 *
 * Emits newline-delimited JSON to stdout/stderr, which is captured by
 * Cloudflare Workers Logs (Real-time Logs / Workers Trace Events) and
 * any external log drain configured in the dashboard.
 */

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

const APP = "worker-notification"

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

export function createLogger(step: string, userId?: string): Logger {
  const base: Record<string, unknown> = { step }
  if (userId) base.userId = userId
  return {
    debug: (msg, extra) => emit("DEBUG", msg, { ...base, ...extra }),
    info:  (msg, extra) => emit("INFO",  msg, { ...base, ...extra }),
    warn:  (msg, extra) => emit("WARN",  msg, { ...base, ...extra }),
    error: (msg, extra) => emit("ERROR", msg, { ...base, ...extra }),
  }
}
