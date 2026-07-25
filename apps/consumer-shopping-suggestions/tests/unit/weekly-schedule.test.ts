import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const defaultsPath = join(here, "../../deploy/schedule-defaults.json")

type ScheduleDefaults = {
  timezone: string
  windowLocal: { day: string; scrapeStart: string; scrapeStop: string }
  githubActionsCronUtc: { createAndDeploy: string; destroy: string }
  githubActionsLocal: { createAndDeploy: string; destroy: string }
}

describe("weekly ephemeral schedule defaults", () => {
  const defaults = JSON.parse(readFileSync(defaultsPath, "utf8")) as ScheduleDefaults

  it("documents Thursday 11:00–12:00 scrape window America/Sao_Paulo", () => {
    expect(defaults.timezone).toBe("America/Sao_Paulo")
    expect(defaults.windowLocal).toEqual({
      day: "Thursday",
      scrapeStart: "11:00",
      scrapeStop: "12:00",
    })
  })

  it("maps create/destroy to UTC CRONs (BRT = UTC-3, no DST)", () => {
    // Create Thu 10:00 BRT → 13:00 UTC; destroy Thu 12:05 BRT → 15:05 UTC
    expect(defaults.githubActionsCronUtc.createAndDeploy).toBe("0 13 * * 4")
    expect(defaults.githubActionsCronUtc.destroy).toBe("5 15 * * 4")
  })

  it("uses standard 5-field cron with Thursday = 4", () => {
    for (const expr of [
      defaults.githubActionsCronUtc.createAndDeploy,
      defaults.githubActionsCronUtc.destroy,
    ]) {
      const parts = expr.split(/\s+/)
      expect(parts).toHaveLength(5)
      expect(parts[4]).toBe("4")
      expect(Number(parts[0])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeLessThan(24)
    }
  })

  it("creates the stack before the scrape window and destroys after", () => {
    expect(defaults.githubActionsLocal.createAndDeploy).toBe("Thursday 10:00")
    expect(defaults.githubActionsLocal.destroy).toBe("Thursday 12:05")

    const createHourUtc = Number(
      defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)[1],
    )
    const destroyHourUtc = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[1])
    const destroyMinuteUtc = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[0])

    // 10:00 BRT = 13:00 UTC; 11:00 BRT = 14:00 UTC; 12:05 BRT = 15:05 UTC
    expect(createHourUtc).toBe(13)
    expect(destroyHourUtc).toBe(15)
    expect(destroyMinuteUtc).toBe(5)
  })
})
