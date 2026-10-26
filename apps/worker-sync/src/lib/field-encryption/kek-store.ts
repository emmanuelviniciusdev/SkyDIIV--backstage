import { decodeAesKey, FieldEncryptionError } from "./field-encryption"
import {
  LOCAL_ENCRYPTION_KEY_VERSION,
  LOCAL_KEK_BASE64,
  LOCAL_LOOKUP_KEY_BASE64,
  useLocalEncryptionKeys,
} from "./local-encryption-keys"

const D1_QUERY =
  "SELECT kek, kek_version, lookup_key, lookup_key_version FROM encryption_keys"

export type EncryptionKeys = {
  kek: Buffer
  kekVersion: number
  lookupKey: Buffer
  lookupKeyVersion: number
  kekByVersion: ReadonlyMap<number, Buffer>
  lookupKeys: readonly Buffer[]
}

type KeyRow = {
  kek: string
  kekVersion: number
  lookupKey: string
  lookupKeyVersion: number
}

type KekStoreDeps = {
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
}

export type EncryptionKeyAdapter = {
  loadEncryptionKeys(): Promise<EncryptionKeys>
}

/** Local development and tests. Returns fixed keys and does not call Cloudflare. */
export function createLocalEncryptionKeyAdapter(): EncryptionKeyAdapter {
  const material = toKeyMaterial([
    {
      kek: LOCAL_KEK_BASE64,
      kekVersion: LOCAL_ENCRYPTION_KEY_VERSION,
      lookupKey: LOCAL_LOOKUP_KEY_BASE64,
      lookupKeyVersion: LOCAL_ENCRYPTION_KEY_VERSION,
    },
  ])
  return {
    loadEncryptionKeys() {
      return Promise.resolve(material)
    },
  }
}

/** Production and staging. Reads `encryption_keys` from Cloudflare D1 on each load. */
export function createD1EncryptionKeyAdapter(deps: KekStoreDeps = {}): EncryptionKeyAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch
  const env = deps.env ?? process.env

  return {
    async loadEncryptionKeys(): Promise<EncryptionKeys> {
      const rows = await queryKeyDatabase(fetchImpl, env)
      return toKeyMaterial(rows)
    },
  }
}

export function createKekStore(deps: KekStoreDeps = {}): EncryptionKeyAdapter {
  const env = deps.env ?? process.env
  if (useLocalEncryptionKeys(env)) return createLocalEncryptionKeyAdapter()
  return createD1EncryptionKeyAdapter(deps)
}

export function loadEncryptionKeys(): Promise<EncryptionKeys> {
  return createKekStore().loadEncryptionKeys()
}

async function queryKeyDatabase(
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<KeyRow[]> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ""
  const databaseId = env.CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID?.trim() ?? ""
  const token = env.CLOUDFLARE_D1_API_TOKEN?.trim() ?? ""
  if (!accountId || !databaseId || !token) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: D1_QUERY }),
    })
  } catch {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }

  if (!response.ok) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  return parseD1Body(body)
}

function parseD1Body(body: unknown): KeyRow[] {
  if (!isRecord(body) || body.success === false) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  const result = body.result
  if (!Array.isArray(result) || result.length === 0 || !isRecord(result[0])) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  return parseKeyRows(result[0].results)
}

function parseKeyRows(value: unknown): KeyRow[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  return value.map((row) => {
    if (!isRecord(row)) {
      throw new FieldEncryptionError("Encryption keys are unavailable")
    }
    const kek = typeof row.kek === "string" ? row.kek : null
    const lookupKey = typeof row.lookup_key === "string"
      ? row.lookup_key
      : typeof row.lookupKey === "string"
        ? row.lookupKey
        : null
    const kekVersion = typeof row.kek_version === "number"
      ? row.kek_version
      : typeof row.kekVersion === "number"
        ? row.kekVersion
        : null
    const lookupKeyVersion = typeof row.lookup_key_version === "number"
      ? row.lookup_key_version
      : typeof row.lookupKeyVersion === "number"
        ? row.lookupKeyVersion
        : null
    if (kek === null || lookupKey === null || kekVersion === null || lookupKeyVersion === null) {
      throw new FieldEncryptionError("Encryption keys are unavailable")
    }
    decodeAesKey(kek)
    decodeAesKey(lookupKey)
    return { kek, kekVersion, lookupKey, lookupKeyVersion }
  })
}

function toKeyMaterial(rows: KeyRow[]): EncryptionKeys {
  const ordered = [...rows].sort((left, right) => {
    if (right.kekVersion !== left.kekVersion) return right.kekVersion - left.kekVersion
    return right.lookupKeyVersion - left.lookupKeyVersion
  })
  const current = ordered[0]
  if (!current) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }

  const kekByVersion = new Map<number, Buffer>()
  for (const row of rows) {
    const kek = decodeAesKey(row.kek)
    const existing = kekByVersion.get(row.kekVersion)
    if (existing && !existing.equals(kek)) {
      throw new FieldEncryptionError("Encryption keys are unavailable")
    }
    kekByVersion.set(row.kekVersion, kek)
  }

  const lookupKeys: Buffer[] = []
  for (const row of rows) {
    const lookupKey = decodeAesKey(row.lookupKey)
    if (!lookupKeys.some((existing) => existing.equals(lookupKey))) {
      lookupKeys.push(lookupKey)
    }
  }

  return {
    kek: decodeAesKey(current.kek),
    kekVersion: current.kekVersion,
    lookupKey: decodeAesKey(current.lookupKey),
    lookupKeyVersion: current.lookupKeyVersion,
    kekByVersion,
    lookupKeys,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
