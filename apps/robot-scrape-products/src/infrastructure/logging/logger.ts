import type { Logger, LoggerFactory } from "../../domain/ports/logger.port.js"

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR"

const LEVEL_ORDER: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
}

const APP = "robot-scrape-products"

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
 * Creates a structured NDJSON logger scoped to a step/module name.
 */
export function createLoggerFactory(minLevel: Level = "INFO"): LoggerFactory {
  const min = LEVEL_ORDER[minLevel]

  return (step: string): Logger => {
    const base: Record<string, unknown> = { step }

    const maybeEmit = (level: Level, msg: string, extra?: Record<string, unknown>) => {
      if (LEVEL_ORDER[level] < min) return
      emit(level, msg, { ...base, ...extra })
    }

    return {
      debug: (msg, extra) => maybeEmit("DEBUG", msg, extra),
      info: (msg, extra) => maybeEmit("INFO", msg, extra),
      warn: (msg, extra) => maybeEmit("WARN", msg, extra),
      error: (msg, extra) => maybeEmit("ERROR", msg, extra),
    }
  }
}
