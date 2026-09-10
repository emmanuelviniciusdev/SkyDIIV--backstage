export function normalizeGrafanaUrl(url) {
  return String(url ?? "").replace(/\/+$/, "")
}

const TYPE_DEFAULT_NAMES = {
  prometheus: "grafanacloud-prom",
  loki: "grafanacloud-logs",
  tempo: "grafanacloud-traces",
}

export async function fetchDatasources(grafanaUrl, token, fetchImpl = fetch) {
  const response = await fetchImpl(`${normalizeGrafanaUrl(grafanaUrl)}/api/datasources`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GET /api/datasources failed: ${response.status} ${text.slice(0, 300)}`)
  }
  return JSON.parse(text)
}

export function pickDatasourceUid(datasources, type) {
  const ofType = (datasources ?? []).filter((item) => item.type === type)
  if (ofType.length === 0) {
    throw new Error(`No Grafana datasource with type ${type}`)
  }
  if (ofType.length === 1) return ofType[0].uid

  const defaultName = TYPE_DEFAULT_NAMES[type]
  const exactDefault = ofType.find((item) => item.name === defaultName)
  if (exactDefault) return exactDefault.uid

  const cloud = ofType.filter((item) => String(item.name).toLowerCase().includes("grafanacloud"))
  if (cloud.length === 1) return cloud[0].uid
  if (cloud.length > 1) {
    const preferred = cloud.find((item) => item.name === defaultName)
    return (preferred ?? cloud[0]).uid
  }

  throw new Error(
    `Multiple ${type} datasources; none named like Grafana Cloud defaults (${defaultName})`,
  )
}

export function resolveDatasourceUids(datasources) {
  return {
    DS_PROMETHEUS: pickDatasourceUid(datasources, "prometheus"),
    DS_LOKI: pickDatasourceUid(datasources, "loki"),
    DS_TEMPO: pickDatasourceUid(datasources, "tempo"),
  }
}
