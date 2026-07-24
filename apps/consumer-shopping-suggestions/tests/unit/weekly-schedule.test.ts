import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const defaultsPath = join(here, "../../deploy/schedule-defaults.json")

type ScheduleDefaults = {
  timezone: string
  windowLocal: { day: string; start: string; stop: string }
  cronUtc: { start: string; stop: string }
}

describe("weekly VM schedule defaults", () => {
  const defaults = JSON.parse(readFileSync(defaultsPath, "utf8")) as ScheduleDefaults

  it("documents Thursday 11:00–12:00 America/Sao_Paulo", () => {
    expect(defaults.timezone).toBe("America/Sao_Paulo")
    expect(defaults.windowLocal).toEqual({
      day: "Thursday",
      start: "11:00",
      stop: "12:00",
    })
  })

  it("maps the local window to UTC CRONs (BRT = UTC-3, no DST)", () => {
    // Thursday 11:00 BRT → 14:00 UTC; Thursday 12:00 BRT → 15:00 UTC
    expect(defaults.cronUtc.start).toBe("0 14 * * 4")
    expect(defaults.cronUtc.stop).toBe("0 15 * * 4")
  })

  it("uses standard 5-field cron with Thursday = 4", () => {
    for (const expr of [defaults.cronUtc.start, defaults.cronUtc.stop]) {
      const parts = expr.split(/\s+/)
      expect(parts).toHaveLength(5)
      expect(parts[4]).toBe("4")
      expect(Number(parts[0])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeLessThan(24)
    }
  })

  it("keeps a 1-hour window between start and stop UTC hours", () => {
    const startHour = Number(defaults.cronUtc.start.split(/\s+/)[1])
    const stopHour = Number(defaults.cronUtc.stop.split(/\s+/)[1])
    expect(stopHour - startHour).toBe(1)
  })
})
