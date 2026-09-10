import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const DASHBOARDS_DIR = path.join(ROOT, "dashboards")

export const REQUIRED_UIDS = [
  "skydiiv-bs-overview",
  "skydiiv-bs-schedules",
  "skydiiv-bs-service-red",
]

export const REJECTED_UIDS = ["skydiiv-bs-web-interactions"]
export const REJECTED_FILES = ["web-backstage-interactions.json"]
export const REQUIRED_TAGS = ["skydiiv", "backstage"]

export const SERVICES = [
  "worker-ai-workflows",
  "worker-scheduler",
  "worker-outbox-events",
  "worker-notification",
  "worker-sync",
  "robot-scrape-products",
]

export const SCHEDULE_ROUTES = [
  "/schedule/every-sunday",
  "/schedule/every-monday",
  "/schedule/every-tuesday",
  "/schedule/every-wednesday",
  "/schedule/every-thursday",
  "/schedule/every-friday",
  "/schedule/every-saturday",
  "/schedule/everyday",
]

export const AI_ROUTES = [
  "/generate-weekly-outfits",
  "/generate-wardrobe-panorama",
  "/generate-search-terms-products-scraping",
  "/analyze-scraped-products-results",
]

export const PII_TERMS = ["email", "prompt", "payload"]

export function loadDashboardFiles(dir = DASHBOARDS_DIR) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Dashboards directory not found: ${dir}`)
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const filePath = path.join(dir, name)
      const raw = fs.readFileSync(filePath, "utf8")
      let dashboard
      try {
        dashboard = JSON.parse(raw)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`${name}: invalid JSON (${message})`, { cause: err })
      }
      return { name, filePath, dashboard }
    })
}

export function collectQueries(dashboard) {
  const queries = []
  walkPanels(dashboard.panels, (panel) => {
    for (const target of panel.targets ?? []) {
      for (const key of ["expr", "query"]) {
        if (typeof target[key] === "string") queries.push(target[key])
      }
    }
  })
  return queries
}

export function collectQueryBlob(dashboard) {
  return collectQueries(dashboard).join("\n")
}

function walkPanels(panels, visit) {
  for (const panel of panels ?? []) {
    visit(panel)
    if (Array.isArray(panel.panels)) walkPanels(panel.panels, visit)
  }
}

function hasVariable(dashboard, name) {
  return (dashboard.templating?.list ?? []).some((item) => item.name === name)
}

export function validateDashboardDir(dir = DASHBOARDS_DIR) {
  const errors = []

  for (const rejected of REJECTED_FILES) {
    if (fs.existsSync(path.join(dir, rejected))) {
      errors.push(`rejected dashboard file must not exist: ${rejected}`)
    }
  }

  let files
  try {
    files = loadDashboardFiles(dir)
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
    return errors
  }

  const uids = new Set()
  let overviewBlob = ""
  let schedulesBlob = ""
  let serviceRed = null

  for (const { name, dashboard } of files) {
    if (!dashboard.uid || typeof dashboard.uid !== "string") {
      errors.push(`${name}: missing uid`)
      continue
    }
    if (REJECTED_UIDS.includes(dashboard.uid)) {
      errors.push(`${name}: rejected uid ${dashboard.uid}`)
    }
    if (uids.has(dashboard.uid)) {
      errors.push(`${name}: duplicate uid ${dashboard.uid}`)
    }
    uids.add(dashboard.uid)

    const tags = dashboard.tags ?? []
    for (const tag of REQUIRED_TAGS) {
      if (!tags.includes(tag)) errors.push(`${name}: missing tag ${tag}`)
    }

    if (!hasVariable(dashboard, "environment")) {
      errors.push(`${name}: missing templating variable environment`)
    }

    const blob = collectQueryBlob(dashboard)
    if (/\brate\s*\(/.test(blob)) {
      errors.push(`${name}: queries must not use rate(); use _over_time`)
    }
    for (const term of PII_TERMS) {
      if (blob.toLowerCase().includes(term)) {
        errors.push(`${name}: query must not contain PII term "${term}"`)
      }
    }

    if (dashboard.uid === "skydiiv-bs-overview") overviewBlob = blob
    if (dashboard.uid === "skydiiv-bs-schedules") schedulesBlob = blob
    if (dashboard.uid === "skydiiv-bs-service-red") serviceRed = dashboard
  }

  for (const uid of REQUIRED_UIDS) {
    if (!uids.has(uid)) errors.push(`missing required dashboard uid: ${uid}`)
  }

  if (overviewBlob) {
    for (const service of SERVICES) {
      if (!overviewBlob.includes(service)) {
        errors.push(`overview: panel targets must include service_name ${service}`)
      }
    }
    if (!overviewBlob.includes('http_route="/"')) {
      errors.push('overview: health-check filter http_route="/" is missing')
    }
    if (!overviewBlob.includes("batch_run_count") || !overviewBlob.includes("batch_run_duration")) {
      errors.push("overview: robot batch_run_count and batch_run_duration queries are required")
    }
  }

  if (schedulesBlob) {
    for (const route of [...SCHEDULE_ROUTES, ...AI_ROUTES]) {
      if (!schedulesBlob.includes(route)) {
        errors.push(`scheduled-pipelines: panel targets must include ${route}`)
      }
    }
    if (!schedulesBlob.includes("batch_run_count")) {
      errors.push("scheduled-pipelines: robot batch_run_count query is required")
    }
  }

  if (serviceRed) {
    if (!hasVariable(serviceRed, "service")) {
      errors.push("service-red: missing templating variable service")
    } else {
      const serviceVar = serviceRed.templating.list.find((item) => item.name === "service")
      const haystack = JSON.stringify(serviceVar)
      for (const service of SERVICES) {
        if (!haystack.includes(service)) {
          errors.push(`service-red: service variable must include ${service}`)
        }
      }
    }
    const raw = JSON.stringify(serviceRed)
    if (!raw.includes("DS_LOKI")) errors.push("service-red: must reference DS_LOKI")
    if (!raw.includes("DS_TEMPO")) errors.push("service-red: must reference DS_TEMPO")
  }

  return errors
}

function main() {
  const errors = validateDashboardDir()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  console.log("Dashboards OK")
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main()
