import path from "node:path"
import { fileURLToPath } from "node:url"
import { DASHBOARDS_DIR, loadDashboardFiles } from "./validate.mjs"
import {
  fetchDatasources,
  normalizeGrafanaUrl,
  resolveDatasourceUids,
} from "./datasources.mjs"

export const FOLDER_UID = "skydiiv"
export const FOLDER_TITLE = "SkyDIIV"

export function requireCredentials(env = process.env) {
  const grafanaUrl = env.GRAFANA_URL?.trim()
  const token = env.GRAFANA_SERVICE_ACCOUNT_TOKEN?.trim()
  if (!grafanaUrl || !token) {
    throw new Error("GRAFANA_URL and GRAFANA_SERVICE_ACCOUNT_TOKEN are required")
  }
  return { grafanaUrl: normalizeGrafanaUrl(grafanaUrl), token }
}

export function substituteDatasourceUids(dashboard, uids) {
  let raw = JSON.stringify(dashboard)
  for (const [placeholder, uid] of Object.entries(uids)) {
    raw = raw.split(placeholder).join(uid)
  }
  const copy = JSON.parse(raw)
  delete copy.id
  return copy
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }
}

async function readJson(response, label) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : {}
}

export async function ensureFolder({ grafanaUrl, token, fetchImpl = fetch }) {
  // List folders instead of GET /api/folders/:uid. Grafana Cloud returns 403
  // (not 404) for an unknown uid, which looks like a permission error.
  const listed = await fetchImpl(`${grafanaUrl}/api/folders`, {
    headers: authHeaders(token),
  })
  const folders = await readJson(listed, "GET /api/folders")
  const existing = Array.isArray(folders)
    ? folders.find((folder) => folder.uid === FOLDER_UID)
    : undefined
  if (existing) return existing

  const created = await fetchImpl(`${grafanaUrl}/api/folders`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ uid: FOLDER_UID, title: FOLDER_TITLE }),
  })
  return readJson(created, "POST /api/folders")
}

export async function upsertDashboard({
  grafanaUrl,
  token,
  dashboard,
  datasourceUids,
  fetchImpl = fetch,
}) {
  const body = {
    dashboard: substituteDatasourceUids(dashboard, datasourceUids),
    folderUid: FOLDER_UID,
    overwrite: true,
    message: "observability/grafana from git",
  }
  const response = await fetchImpl(`${grafanaUrl}/api/dashboards/db`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  return readJson(response, "POST /api/dashboards/db")
}

export async function deployDashboards({
  env = process.env,
  dashboardsDir = DASHBOARDS_DIR,
  fetchImpl = fetch,
} = {}) {
  const { grafanaUrl, token } = requireCredentials(env)
  await ensureFolder({ grafanaUrl, token, fetchImpl })
  const datasources = await fetchDatasources(grafanaUrl, token, fetchImpl)
  const datasourceUids = resolveDatasourceUids(datasources)
  const files = loadDashboardFiles(dashboardsDir)
  const results = []
  for (const { dashboard } of files) {
    results.push(
      await upsertDashboard({
        grafanaUrl,
        token,
        dashboard,
        datasourceUids,
        fetchImpl,
      }),
    )
  }
  return results
}

async function main() {
  try {
    const results = await deployDashboards()
    console.log(`Upserted ${results.length} dashboard(s) into folder ${FOLDER_UID}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  void main()
}
