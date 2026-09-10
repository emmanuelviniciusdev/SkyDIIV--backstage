import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  AI_ROUTES,
  DASHBOARDS_DIR,
  REQUIRED_UIDS,
  SCHEDULE_ROUTES,
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
    tags: ["skydiiv", "backstage"],
    templating: stubTemplating,
    panels: extra.panels ?? [],
    ...extra,
  }
}

describe("validateDashboardDir", () => {
  it("fails when a required uid is missing", () => {
    const dir = writeTempDashboards({
      "overview.json": stubDashboard("skydiiv-bs-overview"),
      "service-red.json": stubDashboard("skydiiv-bs-service-red", {
        templating: {
          list: [
            { name: "environment" },
            {
              name: "service",
              query: SERVICES.join(","),
              options: SERVICES.map((value) => ({ value })),
            },
          ],
        },
        panels: [
          {
            datasource: { uid: "DS_LOKI" },
            targets: [{ expr: '{service_name="$service"}' }],
          },
          {
            datasource: { uid: "DS_TEMPO" },
            targets: [{ query: '{resource.service.name="$service"}' }],
          },
        ],
      }),
    })
    const errors = validateDashboardDir(dir)
    expect(errors.some((error) => error.includes("skydiiv-bs-schedules"))).toBe(true)
  })

  it("rejects the web-interactions dashboard file and uid", () => {
    const dir = writeTempDashboards({
      "web-backstage-interactions.json": stubDashboard("skydiiv-bs-web-interactions"),
    })
    const errors = validateDashboardDir(dir)
    expect(errors.some((error) => error.includes("web-backstage-interactions.json"))).toBe(true)
    expect(errors.some((error) => error.includes("skydiiv-bs-web-interactions"))).toBe(true)
  })

  it("passes a well-formed stub set", () => {
    const workerFilter = SERVICES.filter((name) => name !== "robot-scrape-products").join("|")
    const overviewTargets = [
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
    const scheduleTargets = [...SCHEDULE_ROUTES, ...AI_ROUTES].map((route) => ({
      expr: `count_over_time(http_server_request_count{http_route="${route}"}[$__interval])`,
    }))
    scheduleTargets.push({
      expr: "count_over_time(batch_run_count{service_name=\"robot-scrape-products\"}[$__interval])",
    })

    const dir = writeTempDashboards({
      "overview.json": stubDashboard("skydiiv-bs-overview", {
        panels: [{ targets: overviewTargets }],
      }),
      "scheduled-pipelines.json": stubDashboard("skydiiv-bs-schedules", {
        panels: [{ targets: scheduleTargets }],
      }),
      "service-red.json": stubDashboard("skydiiv-bs-service-red", {
        templating: {
          list: [
            { name: "environment" },
            {
              name: "service",
              query: SERVICES.join(","),
              options: SERVICES.map((value) => ({ value })),
            },
          ],
        },
        panels: [
          { datasource: { uid: "DS_LOKI" }, targets: [{ expr: '{job="x"}' }] },
          { datasource: { uid: "DS_TEMPO" }, targets: [{ query: '{resource.service.name="$service"}' }] },
        ],
      }),
    })
    expect(validateDashboardDir(dir)).toEqual([])
  })

  it("accepts committed dashboards", () => {
    expect(validateDashboardDir(DASHBOARDS_DIR)).toEqual([])
  })
})

describe("committed dashboards", () => {
  it("includes every service on overview and forbids PII query terms", () => {
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

  it("includes scheduled and AI routes", () => {
    const schedules = loadDashboardFiles(DASHBOARDS_DIR).find(
      (file) => file.dashboard.uid === "skydiiv-bs-schedules",
    ).dashboard
    const blob = collectQueryBlob(schedules)
    for (const route of [...SCHEDULE_ROUTES, ...AI_ROUTES]) {
      expect(blob).toContain(route)
    }
  })

  it("parameterizes service-red with Loki and Tempo placeholders", () => {
    const serviceRed = loadDashboardFiles(DASHBOARDS_DIR).find(
      (file) => file.dashboard.uid === "skydiiv-bs-service-red",
    ).dashboard
    const names = serviceRed.templating.list.map((item) => item.name)
    expect(names).toContain("environment")
    expect(names).toContain("service")
    const raw = JSON.stringify(serviceRed)
    expect(raw).toContain("DS_LOKI")
    expect(raw).toContain("DS_TEMPO")
  })
})
