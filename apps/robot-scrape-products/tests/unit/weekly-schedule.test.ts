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

  it("documents Friday create 19:00 / destroy 21:00 America/Sao_Paulo", () => {
    expect(defaults.timezone).toBe("America/Sao_Paulo")
    expect(defaults.windowLocal).toEqual({
      day: "Friday",
      create: "19:00",
      destroy: "21:00",
    })
  })

  it("maps create/destroy to UTC CRONs (BRT = UTC-3, no DST)", () => {
    expect(defaults.githubActionsCronUtc.createAndDeploy).toBe("0 22 * * 5")
    expect(defaults.githubActionsCronUtc.destroy).toBe("0 0 * * 6")
  })

  it("uses standard 5-field cron (Friday create = 5, Saturday destroy = 6)", () => {
    const createParts = defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)
    const destroyParts = defaults.githubActionsCronUtc.destroy.split(/\s+/)

    for (const parts of [createParts, destroyParts]) {
      expect(parts).toHaveLength(5)
      expect(Number(parts[0])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeLessThan(24)
    }

    expect(createParts[4]).toBe("5")
    expect(destroyParts[4]).toBe("6")
  })

  it("creates before destroy on Friday evening (2h window)", () => {
    expect(defaults.githubActionsLocal.createAndDeploy).toBe("Friday 19:00")
    expect(defaults.githubActionsLocal.destroy).toBe("Friday 21:00")

    const createHourUtc = Number(
      defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)[1],
    )
    const destroyHourUtc = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[1])
    const createDow = Number(defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)[4])
    const destroyDow = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[4])

    expect(createHourUtc).toBe(22)
    expect(destroyHourUtc).toBe(0)
    expect(destroyDow).toBe((createDow + 1) % 7)
  })
})
