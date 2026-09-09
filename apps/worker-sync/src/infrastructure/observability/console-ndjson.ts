import type { LogLevel, Logger } from "../../domain/ports/logger.port"

export function emitConsoleNdjson(
  app: string,
  level: LogLevel,
  msg: string,
  ctx: Record<string, unknown>,
): void {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    app,
    msg,
    ...ctx,
  })
  if (level === "ERROR") console.error(entry)
  else if (level === "WARN") console.warn(entry)
  else console.log(entry)
}

export function createConsoleLogger(
  app: string,
  step: string,
  context?: Record<string, string>,
): Logger {
  const base: Record<string, unknown> = { step, ...context }
  return {
    debug: (msg, extra) => emitConsoleNdjson(app, "DEBUG", msg, { ...base, ...extra }),
    info: (msg, extra) => emitConsoleNdjson(app, "INFO", msg, { ...base, ...extra }),
    warn: (msg, extra) => emitConsoleNdjson(app, "WARN", msg, { ...base, ...extra }),
    error: (msg, extra) => emitConsoleNdjson(app, "ERROR", msg, { ...base, ...extra }),
  }
}
