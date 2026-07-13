import type { NeonConfig } from "./config"
import { getNeonConfig } from "./config"

const NEON_API_BASE = "https://console.neon.tech/api/v2"

/** HTTP statuses that are safe to retry for snapshot operations. */
const RETRYABLE_STATUSES = new Set([423, 429, 503])

const MAX_ATTEMPTS = 5
const BASE_RETRY_DELAY_MS = 1_000

export interface NeonSnapshot {
  id: string
  name: string
}

export interface RotateNeonSnapshotResult {
  deletedSnapshotIds: string[]
  createdSnapshot: NeonSnapshot
}

type FetchFn = typeof fetch

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function neonHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const body: { message?: string } = await res.json()
    return body.message ?? res.statusText
  } catch {
    return res.statusText
  }
}

async function neonFetch(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  attempt = 1,
): Promise<Response> {
  const res = await fetchFn(url, init)

  if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt >= MAX_ATTEMPTS) {
    return res
  }

  const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1)
  await sleep(delay)
  return neonFetch(fetchFn, url, init, attempt + 1)
}

export async function listProjectSnapshots(
  config: NeonConfig,
  fetchFn: FetchFn = fetch,
): Promise<NeonSnapshot[]> {
  const url = `${NEON_API_BASE}/projects/${config.projectId}/snapshots`
  const res = await neonFetch(fetchFn, url, {
    method: "GET",
    headers: neonHeaders(config.apiKey),
  })

  if (!res.ok) {
    throw new Error(`Failed to list Neon snapshots (${res.status}): ${await parseErrorBody(res)}`)
  }

  const body: { snapshots?: Array<{ id?: string; name?: string }> } = await res.json()
  return (body.snapshots ?? [])
    .filter((snapshot): snapshot is { id: string; name: string } => {
      return typeof snapshot.id === "string" && typeof snapshot.name === "string"
    })
    .map((snapshot) => ({ id: snapshot.id, name: snapshot.name }))
}

export async function deleteSnapshot(
  config: NeonConfig,
  snapshotId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  const url = `${NEON_API_BASE}/projects/${config.projectId}/snapshots/${snapshotId}`
  const res = await neonFetch(fetchFn, url, {
    method: "DELETE",
    headers: neonHeaders(config.apiKey),
  })

  if (!res.ok) {
    throw new Error(
      `Failed to delete Neon snapshot ${snapshotId} (${res.status}): ${await parseErrorBody(res)}`,
    )
  }
}

export async function createSnapshot(
  config: NeonConfig,
  name: string,
  fetchFn: FetchFn = fetch,
): Promise<NeonSnapshot> {
  const url = `${NEON_API_BASE}/projects/${config.projectId}/branches/${config.branchId}/snapshot`
  const res = await neonFetch(fetchFn, url, {
    method: "POST",
    headers: neonHeaders(config.apiKey),
    body: JSON.stringify({ name }),
  })

  if (!res.ok) {
    throw new Error(`Failed to create Neon snapshot (${res.status}): ${await parseErrorBody(res)}`)
  }

  const body: { snapshot?: { id?: string; name?: string } } = await res.json()
  const id = body.snapshot?.id
  const snapshotName = body.snapshot?.name

  if (!id || !snapshotName) {
    throw new Error("Neon create snapshot response missing snapshot id or name")
  }

  return { id, name: snapshotName }
}

/**
 * Rotates the project's manual snapshot: deletes all existing snapshots, then
 * creates a new one. Required on the Neon Free plan, which allows only one
 * manual snapshot at a time.
 *
 * Resolves Neon credentials from the environment when `config` is omitted.
 */
export async function rotateNeonSnapshot(
  snapshotName: string,
  fetchFn: FetchFn = fetch,
  config?: NeonConfig,
): Promise<RotateNeonSnapshotResult> {
  const resolvedConfig = config ?? getNeonConfig()
  const existing = await listProjectSnapshots(resolvedConfig, fetchFn)
  const deletedSnapshotIds: string[] = []

  for (const snapshot of existing) {
    await deleteSnapshot(resolvedConfig, snapshot.id, fetchFn)
    deletedSnapshotIds.push(snapshot.id)
  }

  const createdSnapshot = await createSnapshot(resolvedConfig, snapshotName, fetchFn)

  return { deletedSnapshotIds, createdSnapshot }
}

export function buildDailySnapshotName(date = new Date()): string {
  const day = date.toISOString().slice(0, 10)
  return `skydiiv-daily-${day}`
}
