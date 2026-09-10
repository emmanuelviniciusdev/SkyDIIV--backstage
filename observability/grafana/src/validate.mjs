import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const DASHBOARDS_DIR = path.join(ROOT, "dashboards")

export const REQUIRED_UIDS = ["skydiiv-bs-overview", "skydiiv-bs-image-uploads"]

export const REJECTED_UIDS = [
  "skydiiv-bs-web-interactions",
  "skydiiv-bs-schedules",
  "skydiiv-bs-service-red",
]
export const REJECTED_FILES = [
  "web-backstage-interactions.json",
  "scheduled-pipelines.json",
  "service-red.json",
]

export const SERVICES = [
  "worker-ai-workflows",
  "worker-scheduler",
  "worker-outbox-events",
  "worker-notification",
  "worker-sync",
  "robot-scrape-products",
]

export const IMAGE_UPLOAD_SERVICE = "skydiiv-web"

export const IMAGE_UPLOAD_ROUTES = [
  "/api/upload/presign",
  "/api/upload/stamp-owner",
  "/api/pieces/classify",
  "/api/user/profile-picture",
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
  let imageUploadsBlob = ""

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
    if (dashboard.uid === "skydiiv-bs-image-uploads") imageUploadsBlob = blob
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

  if (imageUploadsBlob) {
    if (!imageUploadsBlob.includes(`service_name="${IMAGE_UPLOAD_SERVICE}"`)) {
      errors.push(`image-uploads: panel targets must include service_name ${IMAGE_UPLOAD_SERVICE}`)
    }
    for (const route of IMAGE_UPLOAD_ROUTES) {
      if (!imageUploadsBlob.includes(route)) {
        errors.push(`image-uploads: panel targets must include http_route ${route}`)
      }
    }
    if (!imageUploadsBlob.includes('http_request_method="PUT"')) {
      errors.push('image-uploads: profile-picture PUT filter is missing')
    }
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
