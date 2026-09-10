import { describe, expect, it, vi } from "vitest"
import { pickDatasourceUid, resolveDatasourceUids } from "../src/datasources.mjs"
import { deployDashboards, FOLDER_TITLE, FOLDER_UID, requireCredentials } from "../src/deploy.mjs"
import { DASHBOARDS_DIR } from "../src/validate.mjs"

describe("pickDatasourceUid", () => {
  it("prefers a grafanacloud default name when several datasources share a type", () => {
    const uid = pickDatasourceUid(
      [
        { type: "prometheus", name: "local-prom", uid: "local" },
        { type: "prometheus", name: "grafanacloud-prom", uid: "cloud" },
      ],
      "prometheus",
    )
    expect(uid).toBe("cloud")
  })

  it("fails when a type is missing", () => {
    expect(() => pickDatasourceUid([{ type: "loki", name: "logs", uid: "l" }], "prometheus")).toThrow(
      /type prometheus/,
    )
  })

  it("resolves prometheus, loki, and tempo together", () => {
    expect(
      resolveDatasourceUids([
        { type: "prometheus", name: "grafanacloud-prom", uid: "p" },
        { type: "loki", name: "grafanacloud-logs", uid: "l" },
        { type: "tempo", name: "grafanacloud-traces", uid: "t" },
      ]),
    ).toEqual({ DS_PROMETHEUS: "p", DS_LOKI: "l", DS_TEMPO: "t" })
  })
})

describe("requireCredentials", () => {
  it("throws when URL or token is missing", () => {
    expect(() => requireCredentials({})).toThrow(/GRAFANA_URL/)
    expect(() => requireCredentials({ GRAFANA_URL: "https://x.grafana.net" })).toThrow(
      /GRAFANA_SERVICE_ACCOUNT_TOKEN/,
    )
  })
})

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

describe("deployDashboards", () => {
  const env = {
    GRAFANA_URL: "https://example.grafana.net/",
    GRAFANA_SERVICE_ACCOUNT_TOKEN: "glsa_test",
  }

  const datasources = [
    { type: "prometheus", name: "grafanacloud-prom", uid: "prom-uid" },
    { type: "loki", name: "grafanacloud-logs", uid: "loki-uid" },
    { type: "tempo", name: "grafanacloud-traces", uid: "tempo-uid" },
  ]

  it("creates the folder when the list does not include it, then upserts dashboards", async () => {
    const posts = []
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const method = init.method ?? "GET"
      const href = String(url)
      if (method === "GET" && href.endsWith("/api/folders")) {
        return jsonResponse(200, [
          { id: -1, uid: "sharedwithme", title: "Shared with me" },
          { id: 1, uid: "cfxoue45zbabkf", title: "GrafanaCloud" },
        ])
      }
      if (method === "POST" && href.endsWith("/api/folders")) {
        posts.push({ kind: "folder", body: JSON.parse(init.body) })
        return jsonResponse(200, { uid: FOLDER_UID })
      }
      if (method === "GET" && href.endsWith("/api/datasources")) {
        return jsonResponse(200, datasources)
      }
      if (method === "POST" && href.endsWith("/api/dashboards/db")) {
        const body = JSON.parse(init.body)
        posts.push({ kind: "dashboard", body })
        return jsonResponse(200, { status: "success", uid: body.dashboard.uid })
      }
      throw new Error(`unexpected ${method} ${href}`)
    })

    await deployDashboards({ env, dashboardsDir: DASHBOARDS_DIR, fetchImpl })

    const folder = posts.find((item) => item.kind === "folder")
    expect(folder.body).toEqual({ uid: FOLDER_UID, title: FOLDER_TITLE })
    const dashPosts = posts.filter((item) => item.kind === "dashboard")
    expect(dashPosts).toHaveLength(1)
    for (const item of dashPosts) {
      expect(item.body.overwrite).toBe(true)
      expect(item.body.folderUid).toBe(FOLDER_UID)
      expect(item.body.dashboard.id).toBeUndefined()
      expect(item.body.dashboard.uid).toMatch(/^skydiiv-bs-/)
    }
  })

  it("is idempotent: a second deploy reuses the folder and overwrites the same uids", async () => {
    const dashboardUids = []
    const fetchImpl = vi.fn(async (url, init = {}) => {
      const method = init.method ?? "GET"
      const href = String(url)
      if (method === "GET" && href.endsWith("/api/folders")) {
        return jsonResponse(200, [{ uid: FOLDER_UID, title: FOLDER_TITLE }])
      }
      if (method === "GET" && href.endsWith("/api/datasources")) {
        return jsonResponse(200, datasources)
      }
      if (method === "POST" && href.endsWith("/api/dashboards/db")) {
        const body = JSON.parse(init.body)
        dashboardUids.push(body.dashboard.uid)
        expect(body.overwrite).toBe(true)
        return jsonResponse(200, { status: "success", uid: body.dashboard.uid })
      }
      throw new Error(`unexpected ${method} ${href}`)
    })

    await deployDashboards({ env, dashboardsDir: DASHBOARDS_DIR, fetchImpl })
    const first = [...dashboardUids]
    dashboardUids.length = 0
    await deployDashboards({ env, dashboardsDir: DASHBOARDS_DIR, fetchImpl })
    expect(dashboardUids).toEqual(first)
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).endsWith("/api/folders") && call[1]?.method === "POST")).toBe(
      false,
    )
  })

  it("fails the process on Grafana 5xx", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/api/folders")) {
        return jsonResponse(500, { message: "boom" })
      }
      throw new Error(`unexpected ${url}`)
    })
    await expect(deployDashboards({ env, dashboardsDir: DASHBOARDS_DIR, fetchImpl })).rejects.toThrow(
      /500/,
    )
  })
})

describe("validate does not call Grafana", () => {
  it("does not use fetch", async () => {
    const { validateDashboardDir } = await import("../src/validate.mjs")
    const spy = vi.spyOn(globalThis, "fetch")
    validateDashboardDir(DASHBOARDS_DIR)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
