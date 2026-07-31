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

  it("documents Sunday create 07:00 / destroy 09:00 America/Sao_Paulo", () => {
    expect(defaults.timezone).toBe("America/Sao_Paulo")
    expect(defaults.windowLocal).toEqual({
      day: "Sunday",
      create: "07:00",
      destroy: "09:00",
    })
  })

  it("maps create/destroy to UTC CRONs (BRT = UTC-3, no DST)", () => {
    // Create Sun 07:00 BRT → 10:00 UTC; destroy Sun 09:00 BRT → 12:00 UTC
    expect(defaults.githubActionsCronUtc.createAndDeploy).toBe("0 10 * * 0")
    expect(defaults.githubActionsCronUtc.destroy).toBe("0 12 * * 0")
  })

  it("uses standard 5-field cron with Sunday = 0", () => {
    for (const expr of [
      defaults.githubActionsCronUtc.createAndDeploy,
      defaults.githubActionsCronUtc.destroy,
    ]) {
      const parts = expr.split(/\s+/)
      expect(parts).toHaveLength(5)
      expect(parts[4]).toBe("0")
      expect(Number(parts[0])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeGreaterThanOrEqual(0)
      expect(Number(parts[1])).toBeLessThan(24)
    }
  })

  it("creates before destroy on Sunday morning", () => {
    expect(defaults.githubActionsLocal.createAndDeploy).toBe("Sunday 07:00")
    expect(defaults.githubActionsLocal.destroy).toBe("Sunday 09:00")

    const createHourUtc = Number(
      defaults.githubActionsCronUtc.createAndDeploy.split(/\s+/)[1],
    )
    const destroyHourUtc = Number(defaults.githubActionsCronUtc.destroy.split(/\s+/)[1])

    expect(createHourUtc).toBe(10)
    expect(destroyHourUtc).toBe(12)
    expect(destroyHourUtc).toBeGreaterThan(createHourUtc)
  })
})
