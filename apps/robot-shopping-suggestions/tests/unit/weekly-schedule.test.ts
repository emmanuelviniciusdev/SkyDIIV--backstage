import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const defaultsPath = join(here, "../../deploy/schedule-defaults.json")

type ScheduleDefaults = {
  timezone: string
  windowLocal: { day: string; create: string; destroy: string }
  githubActionsCronUtc: { createAndDeploy: string; destroy: string }
  githubActionsLocal: { createAndDeploy: string; destroy: string }
}

describe("weekly ephemeral schedule defaults", () => {
  const defaults = JSON.parse(readFileSync(defaultsPath, "utf8")) as ScheduleDefaults

  it("documents Thursday create 19:00 / destroy 21:00 America/Sao_Paulo", () => {
    expect(defaults.timezone).toBe("America/Sao_Paulo")
    expect(defaults.windowLocal).toEqual({
      day: "Thursday",
      create: "19:00",
      destroy: "21:00",
    })
  })

  it("maps create/destroy to UTC CRONs (BRT = UTC-3, no DST)", () => {
    // Create Thu 19:00 BRT → 22:00 UTC; destroy Thu 21:00 BRT → Fri 00:00 UTC
    expect(defaults.githubActionsCronUtc.createAndDeploy).toBe("0 22 * * 4")
    expect(defaults.githubActionsCronUtc.destroy).toBe("0 0 * * 5")
  })

  it("uses standard 5-field cron (Thursday create = 4, Friday destroy = 5)", () => {
    const createParts = defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)
    const destroyParts = defaults.githubActionsCronUtc.destroy.split(/\s+/)

    for (const parts of [createParts, destroyParts]) {
      expect(parts).toHaveLength(5)
      expect(Number(parts[0])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeLessThan(24)
    }

    expect(createParts[4]).toBe("4")
    expect(destroyParts[4]).toBe("5")
  })

  it("creates before destroy on Thursday evening (2h window)", () => {
    expect(defaults.githubActionsLocal.createAndDeploy).toBe("Thursday 19:00")
    expect(defaults.githubActionsLocal.destroy).toBe("Thursday 21:00")

    const createHourUtc = Number(
      defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)[1],
    )
    const destroyHourUtc = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[1])
    const createDow = Number(defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)[4])
    const destroyDow = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[4])

    expect(createHourUtc).toBe(22)
    expect(destroyHourUtc).toBe(0)
    // Destroy is Friday 00:00 UTC — next calendar day after Thursday 22:00 UTC
    expect(destroyDow).toBe((createDow + 1) % 7)
  })
})
