import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto"

/**
 * Envelope for listed columns. Byte layout shared with SkyDIIV web:
 * - Wrapped DEK and field ciphertext are standard base64 of
 *   12-byte nonce || ciphertext || 16-byte GCM tag.
 * - Field additional authenticated data is UTF-8 of
 *   table + NUL + column + NUL + row id. DEK wrap has no AAD.
 * - Lookup hash is standard base64 of HMAC-SHA256(lookup key,
 *   UTF-8 of table + NUL + column + NUL + normalized plaintext).
 * - Email is trimmed and lowercased before hashing and before it is sealed.
 */

const NONCE_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export class FieldEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FieldEncryptionError"
  }
}

export type ListedField = {
  prisma: string
  column: string
}

export type LookupField = {
  prisma: string
  column: string
  hashPrisma: string
  hashColumn: string
}

export type EncryptedModelSpec = {
  table: string
  fields: readonly ListedField[]
  lookup: readonly LookupField[]
}

/**
 * Columns sealed on write. `encrypted_columns` on a row names the fields
 * below that currently hold ciphertext (nulls are omitted).
 *
 * Left plaintext so SQL contains / in / orderBy still work:
 * `clothing_items.title`, `outfits.title`, `tags.name`.
 * Workers also leave `created_by` / `updated_by` plaintext (service names).
 */
export const ENCRYPTED_MODELS: Record<string, EncryptedModelSpec> = {
  ClothingItem: {
    table: "clothing_items",
    fields: [{ prisma: "imageUrl", column: "image_url" }],
    lookup: [],
  },
  FeedbackAutomaticThrifting: {
    table: "feedbacks_automatic_thrifting",
    fields: [{ prisma: "reason", column: "reason" }],
    lookup: [],
  },
  SummaryFeedbackAutomaticThrifting: {
    table: "summaries_feedbacks_automatic_thrifting",
    fields: [{ prisma: "summary", column: "summary" }],
    lookup: [],
  },
  LlmInteraction: {
    table: "llm_interactions",
    fields: [
      { prisma: "prompt", column: "prompt" },
      { prisma: "clientPrompt", column: "client_prompt" },
      { prisma: "response", column: "response" },
    ],
    lookup: [],
  },
  Outfit: {
    table: "outfits",
    fields: [{ prisma: "imageUrl", column: "image_url" }],
    lookup: [],
  },
  ShoppingSuggestionsPreferences: {
    table: "shopping_suggestions_preferences",
    fields: [
      { prisma: "topSize", column: "top_size" },
      { prisma: "bottomSize", column: "bottom_size" },
      { prisma: "footSize", column: "foot_size" },
      { prisma: "gender", column: "gender" },
    ],
    lookup: [],
  },
  User: {
    table: "users",
    fields: [
      { prisma: "firstName", column: "first_name" },
      { prisma: "lastName", column: "last_name" },
      { prisma: "preferredName", column: "preferred_name" },
      { prisma: "email", column: "email" },
      { prisma: "birthDate", column: "birth_date" },
      { prisma: "profilePictureUrl", column: "profile_picture_url" },
    ],
    lookup: [
      {
        prisma: "email",
        column: "email",
        hashPrisma: "emailLookup",
        hashColumn: "email_lookup",
      },
    ],
  },
  WardrobePanorama: {
    table: "wardrobe_panorama",
    fields: [{ prisma: "content", column: "content" }],
    lookup: [],
  },
  WeeklyOutfitPreferences: {
    table: "weekly_outfit_preferences",
    fields: [
      { prisma: "location", column: "location" },
      { prisma: "routineDescription", column: "routine_description" },
    ],
    lookup: [],
  },
}

export const ENVELOPE_PRISMA_FIELDS = [
  "dek",
  "kekVersion",
  "encryptedColumns",
  "lookupColumns",
  "emailLookup",
] as const

export type SealedModelValues = {
  values: Record<string, string | null>
  dek: string
  kekVersion: number
  encryptedColumns: string[]
  lookupColumns: string[]
  hashes: Record<string, string>
}

export function isEncryptedModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(ENCRYPTED_MODELS, model)
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function decodeAesKey(encoded: string): Buffer {
  const trimmed = encoded.trim()
  const key = Buffer.from(trimmed, "base64")
  if (key.length !== KEY_BYTES || key.toString("base64") !== trimmed) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  return key
}

export function lookupHash(params: {
  lookupKey: Buffer
  table: string
  column: string
  plaintext: string
}): string {
  const message = Buffer.from(
    `${params.table}\0${params.column}\0${params.plaintext}`,
    "utf8",
  )
  return createHmac("sha256", params.lookupKey).update(message).digest("base64")
}

export function emailLookupCandidates(email: string, lookupKeys: readonly Buffer[]): string[] {
  const normalized = normalizeEmail(email)
  return lookupKeys.map((lookupKey) =>
    lookupHash({
      lookupKey,
      table: "users",
      column: "email",
      plaintext: normalized,
    }),
  )
}

export function tagNameLookupCandidates(name: string, lookupKeys: readonly Buffer[]): string[] {
  return lookupKeys.map((lookupKey) =>
    lookupHash({
      lookupKey,
      table: "tags",
      column: "name",
      plaintext: name,
    }),
  )
}

export function sealModelValues(input: {
  model: string
  rowId: string
  values: Record<string, string | null>
  kek: Buffer
  kekVersion: number
  lookupKey: Buffer
}): SealedModelValues {
  const spec = ENCRYPTED_MODELS[input.model]
  if (!spec) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }

  const dek = randomBytes(KEY_BYTES)
  const values: Record<string, string | null> = {}
  const encryptedColumns: string[] = []
  const lookupColumns: string[] = []
  const hashes: Record<string, string> = {}

  for (const field of spec.fields) {
    if (!Object.prototype.hasOwnProperty.call(input.values, field.prisma)) continue
    const raw = input.values[field.prisma]
    if (raw === null) {
      values[field.prisma] = null
      continue
    }
    const stored = canonicalPlaintext(spec.table, field.column, raw)
    values[field.prisma] = encryptField({
      dek,
      table: spec.table,
      column: field.column,
      rowId: input.rowId,
      plaintext: stored,
    })
    encryptedColumns.push(field.column)
  }

  for (const lookup of spec.lookup) {
    const sealed = values[lookup.prisma]
    if (sealed === undefined || sealed === null) continue
    const plaintext = canonicalPlaintext(
      spec.table,
      lookup.column,
      input.values[lookup.prisma] ?? "",
    )
    hashes[lookup.hashPrisma] = lookupHash({
      lookupKey: input.lookupKey,
      table: spec.table,
      column: lookup.column,
      plaintext,
    })
    lookupColumns.push(lookup.column)
  }

  return {
    values,
    dek: wrapDek(dek, input.kek),
    kekVersion: input.kekVersion,
    encryptedColumns,
    lookupColumns,
    hashes,
  }
}

export function openModelValues(input: {
  model: string
  rowId: string
  values: Record<string, string | null>
  dek: string
  kek: Buffer
  encryptedColumns: readonly string[]
}): Record<string, string | null> {
  const spec = ENCRYPTED_MODELS[input.model]
  if (!spec) {
    throw new FieldEncryptionError("Encryption keys are unavailable")
  }
  const dek = unwrapDek(input.dek, input.kek)
  const opened: Record<string, string | null> = { ...input.values }
  for (const column of input.encryptedColumns) {
    const field = spec.fields.find((candidate) => candidate.column === column)
    if (!field) {
      throw new FieldEncryptionError("Failed to decrypt field")
    }
    const ciphertext = input.values[field.prisma]
    if (ciphertext === null) {
      opened[field.prisma] = null
      continue
    }
    if (typeof ciphertext !== "string") {
      throw new FieldEncryptionError("Failed to decrypt field")
    }
    opened[field.prisma] = decryptField({
      dek,
      table: spec.table,
      column,
      rowId: input.rowId,
      payload: ciphertext,
    })
  }
  return opened
}

export function encryptField(params: {
  dek: Buffer
  table: string
  column: string
  rowId: string
  plaintext: string
}): string {
  return encryptAesGcm(params.dek, Buffer.from(params.plaintext, "utf8"), authenticatedData(params))
}

export function decryptField(params: {
  dek: Buffer
  table: string
  column: string
  rowId: string
  payload: string
}): string {
  return decryptAesGcm(params.dek, params.payload, authenticatedData(params)).toString("utf8")
}

function canonicalPlaintext(table: string, column: string, value: string): string {
  if (table === "users" && column === "email") return normalizeEmail(value)
  if (table === "users" && column === "birth_date") return canonicalBirthDate(value)
  return value
}

function canonicalBirthDate(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10)
  throw new FieldEncryptionError("Failed to encrypt field")
}

function authenticatedData(params: { table: string; column: string; rowId: string }): Buffer {
  return Buffer.from(`${params.table}\0${params.column}\0${params.rowId}`, "utf8")
}

function wrapDek(dek: Buffer, kek: Buffer): string {
  return encryptAesGcm(kek, dek)
}

function unwrapDek(wrapped: string, kek: Buffer): Buffer {
  const dek = decryptAesGcm(kek, wrapped)
  if (dek.length !== KEY_BYTES) {
    throw new FieldEncryptionError("Failed to decrypt field")
  }
  return dek
}

function encryptAesGcm(key: Buffer, plaintext: Buffer, aad?: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  if (aad) cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, tag]).toString("base64")
}

function decryptAesGcm(key: Buffer, payload: string, aad?: Buffer): Buffer {
  const packed = Buffer.from(payload, "base64")
  if (packed.length < NONCE_BYTES + TAG_BYTES) {
    throw new FieldEncryptionError("Failed to decrypt field")
  }
  const nonce = packed.subarray(0, NONCE_BYTES)
  const tag = packed.subarray(packed.length - TAG_BYTES)
  const ciphertext = packed.subarray(NONCE_BYTES, packed.length - TAG_BYTES)
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce)
    if (aad) decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new FieldEncryptionError("Failed to decrypt field")
  }
}
