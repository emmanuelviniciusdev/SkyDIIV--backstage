import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  DASHBOARDS_DIR,
  REQUIRED_UIDS,
  SERVICES,
  collectQueryBlob,
  loadDashboardFiles,
  validateDashboardDir,
} from "../src/validate.mjs"

function writeTempDashboards(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grafana-dashboards-"))
  for (const [name, dashboard] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(dashboard))
  }
  return dir
}

const stubTemplating = {
  list: [{ name: "environment", type: "custom", query: "production,staging,local" }],
}

function stubDashboard(uid, extra = {}) {
  return {
    uid,
    templating: stubTemplating,
    panels: extra.panels ?? [],
    ...extra,
  }
}

function overviewTargets() {
  const workerFilter = SERVICES.filter((name) => name !== "robot-scrape-products").join("|")
  return [
    {
      expr: `count_over_time(http_server_request_count{service_name=~"${workerFilter}",http_route="/"}[$__interval])`,
    },
    {
      expr: 'count_over_time(batch_run_count{service_name="robot-scrape-products"}[$__interval])',
    },
    {
      expr: 'avg_over_time(batch_run_duration{service_name="robot-scrape-products"}[$__interval])',
    },
  ]
}

describe("validateDashboardDir", () => {
  it("fails when a required uid is missing", () => {
    const dir = writeTempDashboards({})
    const errors = validateDashboardDir(dir)
    expect(errors.some((error) => error.includes("skydiiv-bs-overview"))).toBe(true)
  })

  it("rejects extra dashboard files and uids", () => {
    const dir = writeTempDashboards({
      "web-backstage-interactions.json": stubDashboard("skydiiv-bs-web-interactions"),
      "scheduled-pipelines.json": stubDashboard("skydiiv-bs-schedules"),
      "service-red.json": stubDashboard("skydiiv-bs-service-red"),
    })
    const errors = validateDashboardDir(dir)
    expect(errors.some((error) => error.includes("web-backstage-interactions.json"))).toBe(true)
    expect(errors.some((error) => error.includes("scheduled-pipelines.json"))).toBe(true)
    expect(errors.some((error) => error.includes("service-red.json"))).toBe(true)
    expect(errors.some((error) => error.includes("skydiiv-bs-web-interactions"))).toBe(true)
    expect(errors.some((error) => error.includes("skydiiv-bs-schedules"))).toBe(true)
    expect(errors.some((error) => error.includes("skydiiv-bs-service-red"))).toBe(true)
  })

  it("passes a well-formed overview stub", () => {
    const dir = writeTempDashboards({
      "overview.json": stubDashboard("skydiiv-bs-overview", {
        panels: [{ targets: overviewTargets() }],
      }),
    })
    expect(validateDashboardDir(dir)).toEqual([])
  })

  it("accepts committed dashboards", () => {
    expect(validateDashboardDir(DASHBOARDS_DIR)).toEqual([])
  })
})

describe("committed dashboards", () => {
  it("ships only overview and forbids PII query terms", () => {
    const files = Object.fromEntries(
      loadDashboardFiles(DASHBOARDS_DIR).map((file) => [file.dashboard.uid, file.dashboard]),
    )
    expect(Object.keys(files).sort()).toEqual([...REQUIRED_UIDS].sort())
    const overview = collectQueryBlob(files["skydiiv-bs-overview"])
    for (const service of SERVICES) {
      expect(overview).toContain(service)
    }
    expect(overview).not.toMatch(/\brate\s*\(/)
    for (const term of ["email", "prompt", "payload"]) {
      expect(overview.toLowerCase()).not.toContain(term)
    }
  })
})
