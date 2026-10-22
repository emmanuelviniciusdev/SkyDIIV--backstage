import {
  ENCRYPTED_MODELS,
  FieldEncryptionError,
  openModelValues,
  sealModelValues,
  type SealedModelValues,
} from "./field-encryption"
import { loadEncryptionKeys, type EncryptionKeys } from "./kek-store"

export type ListedRowInput = {
  model: string
  rowId: string
  values: Record<string, string | null>
  dek: string | null | undefined
  kekVersion: number | null | undefined
  encryptedColumns: readonly string[] | null | undefined
}

function columnsToOpen(input: ListedRowInput): string[] {
  const spec = ENCRYPTED_MODELS[input.model]
  if (!spec) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  const source = input.encryptedColumns
  const columns: readonly string[] = Array.isArray(source) ? source : []
  const opened: string[] = []
  for (const column of columns) {
    if (typeof column !== "string") continue
    const field = spec.fields.find((candidate) => candidate.column === column)
    if (field != null && Object.prototype.hasOwnProperty.call(input.values, field.prisma)) {
      opened.push(column)
    }
  }
  return opened
}

function openWithKeys(keys: EncryptionKeys, input: ListedRowInput): Record<string, string | null> {
  const columns = columnsToOpen(input)
  if (input.dek == null || columns.length === 0) {
    return { ...input.values }
  }
  if (typeof input.dek !== "string" || input.dek.length === 0 || input.kekVersion == null) {
    throw new FieldEncryptionError("Failed to decrypt field")
  }
  const kek = keys.kekByVersion.get(input.kekVersion)
  if (!kek) {
    throw new FieldEncryptionError("Failed to decrypt field")
  }
  return openModelValues({
    model: input.model,
    rowId: input.rowId,
    values: input.values,
    dek: input.dek,
    kek,
    encryptedColumns: columns,
  })
}

/** One key load shared by every sealed row in a single repository call. */
export function createListedRowOpener(): (input: ListedRowInput) => Promise<Record<string, string | null>> {
  let keys: Promise<EncryptionKeys> | null = null
  return async (input) => {
    const columns = columnsToOpen(input)
    if (input.dek == null || columns.length === 0) {
      return { ...input.values }
    }
    keys ??= loadEncryptionKeys()
    return openWithKeys(await keys, input)
  }
}

export async function openListedRow(input: ListedRowInput): Promise<Record<string, string | null>> {
  return createListedRowOpener()(input)
}

export async function sealListedFields(input: {
  model: string
  rowId: string
  values: Record<string, string | null>
}): Promise<SealedModelValues> {
  const keys = await loadEncryptionKeys()
  return sealModelValues({
    model: input.model,
    rowId: input.rowId,
    values: input.values,
    kek: keys.kek,
    kekVersion: keys.kekVersion,
    lookupKey: keys.lookupKey,
  })
}
