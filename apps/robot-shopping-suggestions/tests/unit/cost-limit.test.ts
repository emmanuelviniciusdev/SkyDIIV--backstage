import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const defaultsPath = join(here, "../../deploy/cost-limit-defaults.json")

type CostLimitDefaults = {
  costLimitUsd: number
  costAlertEmail: string
  budgetReset: string
  alertPercents: number[]
  enforcement: string
}

describe("monthly cost limit defaults", () => {
  const defaults = JSON.parse(readFileSync(defaultsPath, "utf8")) as CostLimitDefaults

  it("defaults to a $5.00 monthly ceiling", () => {
    expect(defaults.costLimitUsd).toBe(5)
  })

  it("defaults cost alert email", () => {
    expect(defaults.costAlertEmail).toBe("emmanuel.bergmann@icloud.com")
  })

  it("resets the budget monthly and alerts at 80% and 100%", () => {
    expect(defaults.budgetReset).toBe("MONTHLY")
    expect(defaults.alertPercents).toEqual([80, 100])
  })

  it("enforces the ceiling by destroying the full robot Terraform stack", () => {
    expect(defaults.enforcement).toBe("terraform-destroy")
  })
})
