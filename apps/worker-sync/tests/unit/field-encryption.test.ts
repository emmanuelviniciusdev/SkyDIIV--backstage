import { createDecipheriv } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  ENCRYPTED_MODELS,
  emailLookupCandidates,
  encryptField,
  FieldEncryptionError,
  lookupHash,
  normalizeEmail,
  openModelValues,
  sealModelValues,
  tagNameLookupCandidates,
} from "../../src/lib/field-encryption/field-encryption"
import {
  LOCAL_ENCRYPTION_KEY_VERSION,
  LOCAL_KEK,
  LOCAL_KEK_BASE64,
  LOCAL_LOOKUP_KEY,
  LOCAL_LOOKUP_KEY_BASE64,
} from "../../src/lib/field-encryption/local-encryption-keys"

const kek = Buffer.alloc(32, 7)
const lookupKey = Buffer.alloc(32, 9)

function sealUser(values: Record<string, string | null>, rowId = "user-1") {
  return sealModelValues({
    model: "User",
    rowId,
    values,
    kek,
    kekVersion: 1,
    lookupKey,
  })
}

function decryptPacked(key: Buffer, payload: string, aad?: Buffer): Buffer {
  const packed = Buffer.from(payload, "base64")
  const nonce = packed.subarray(0, 12)
  const tag = packed.subarray(packed.length - 16)
  const ciphertext = packed.subarray(12, packed.length - 16)
  const decipher = createDecipheriv("aes-256-gcm", key, nonce)
  if (aad) decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

describe("field encryption", () => {
  it("maps only the columns that are sealed today", () => {
    expect(ENCRYPTED_MODELS.ClothingItem.fields.map((field) => field.column)).toEqual([
      "image_url",
      "created_by",
      "updated_by",
    ])
    expect(ENCRYPTED_MODELS.Outfit.fields.map((field) => field.column)).toEqual([
      "image_url",
      "created_by",
      "updated_by",
    ])
    expect(ENCRYPTED_MODELS.Tag.fields.map((field) => field.column)).toEqual(["created_by", "updated_by"])
  })

  it("round-trips AES-256-GCM and omits null columns", () => {
    const sealedImage = sealModelValues({
      model: "ClothingItem",
      rowId: "piece-1",
      values: { imageUrl: "https://img", title: "Linen shirt" },
      kek,
      kekVersion: 1,
      lookupKey,
    })
    expect(sealedImage.values.title).toBeUndefined()
    expect(sealedImage.values.imageUrl).not.toBe("https://img")
    expect(sealedImage.encryptedColumns).toEqual(["image_url"])
    expect(sealedImage.lookupColumns).toEqual([])
    expect(
      openModelValues({
        model: "ClothingItem",
        rowId: "piece-1",
        values: sealedImage.values,
        dek: sealedImage.dek,
        kek,
        encryptedColumns: sealedImage.encryptedColumns,
      }).imageUrl,
    ).toBe("https://img")

    const sealed = sealUser({
      firstName: "Ada",
      lastName: "Lovelace",
      preferredName: null,
      email: "ada@example.com",
      birthDate: "1990-01-02",
      profilePictureUrl: null,
    })

    expect(sealed.values.preferredName).toBeNull()
    expect(sealed.values.profilePictureUrl).toBeNull()
    expect(sealed.encryptedColumns).not.toContain("preferred_name")
    expect(sealed.encryptedColumns).not.toContain("profile_picture_url")
    expect(sealed.encryptedColumns).toContain("first_name")
    expect(sealed.values.firstName).not.toBe("Ada")
    expect(sealed.lookupColumns).toContain("email")
    expect(sealed.hashes.emailLookup).toBeTruthy()
    expect(sealed.hashes.emailLookup).not.toBe("ada@example.com")

    const opened = openModelValues({
      model: "User",
      rowId: "user-1",
      values: sealed.values,
      dek: sealed.dek,
      kek,
      encryptedColumns: sealed.encryptedColumns,
    })
    expect(opened.firstName).toBe("Ada")
    expect(opened.preferredName).toBeNull()
    expect(opened.profilePictureUrl).toBeNull()
    expect(opened.email).toBe("ada@example.com")
  })

  it("binds field ciphertext to table, column, and row id and wraps the DEK with no AAD", () => {
    const sealed = sealModelValues({
      model: "ClothingItem",
      rowId: "piece-1",
      values: { imageUrl: "https://img" },
      kek,
      kekVersion: 1,
      lookupKey,
    })
    const payload = sealed.values.imageUrl
    if (!payload) throw new Error("expected ciphertext")

    expect(() =>
      openModelValues({
        model: "ClothingItem",
        rowId: "other-piece",
        values: { imageUrl: payload },
        dek: sealed.dek,
        kek,
        encryptedColumns: ["image_url"],
      }),
    ).toThrow(/decrypt/i)

    const dek = decryptPacked(kek, sealed.dek)
    expect(dek).toHaveLength(32)
    expect(() => decryptPacked(kek, sealed.dek, Buffer.from("aad"))).toThrow()

    const aad = Buffer.from("clothing_items\0image_url\0piece-1", "utf8")
    expect(decryptPacked(dek, payload, aad).toString("utf8")).toBe("https://img")
    expect(() =>
      decryptPacked(dek, payload, Buffer.from("clothing_items\0image_url\0other", "utf8")),
    ).toThrow()
  })

  it("uses the local KEK and lookup key bytes", () => {
    expect(LOCAL_KEK_BASE64).toBe(Buffer.alloc(32, 0x11).toString("base64"))
    expect(LOCAL_LOOKUP_KEY_BASE64).toBe(Buffer.alloc(32, 0x22).toString("base64"))
    expect(LOCAL_KEK.equals(Buffer.alloc(32, 0x11))).toBe(true)
    expect(LOCAL_LOOKUP_KEY.equals(Buffer.alloc(32, 0x22))).toBe(true)
    expect(LOCAL_ENCRYPTION_KEY_VERSION).toBe(1)
  })

  it("fails closed on a truncated payload", () => {
    const sealed = sealModelValues({
      model: "ClothingItem",
      rowId: "piece-1",
      values: { imageUrl: "https://img" },
      kek,
      kekVersion: 1,
      lookupKey,
    })
    expect(() =>
      openModelValues({
        model: "ClothingItem",
        rowId: "piece-1",
        values: { imageUrl: Buffer.from("short").toString("base64") },
        dek: sealed.dek,
        kek,
        encryptedColumns: ["image_url"],
      }),
    ).toThrow(FieldEncryptionError)
    expect(() =>
      openModelValues({
        model: "ClothingItem",
        rowId: "piece-1",
        values: { imageUrl: "https://img" },
        dek: Buffer.from("tiny").toString("base64"),
        kek,
        encryptedColumns: ["image_url"],
      }),
    ).toThrow(/decrypt/i)
  })

  it("seals the same email as different ciphertext with one lookup hash", () => {
    const first = sealUser({ email: " Ada@Example.com " })
    const second = sealUser({ email: "ada@example.com" })

    expect(first.values.email).not.toBe(second.values.email)
    expect(first.values.email).not.toBe("ada@example.com")
    expect(first.hashes.emailLookup).toBe(second.hashes.emailLookup)
    expect(first.lookupColumns).toEqual(["email"])
    expect(normalizeEmail(" Ada@Example.com ")).toBe("ada@example.com")
  })

  it("keeps tag-name lookup hashes case-sensitive", () => {
    const lower = tagNameLookupCandidates("linen", [lookupKey])
    const upper = tagNameLookupCandidates("Linen", [lookupKey])
    expect(lower[0]).not.toBe(upper[0])
  })

  it("stores a birth date as YYYY-MM-DD inside the envelope", () => {
    const sealed = sealUser({ birthDate: "1990-01-02" })
    expect(sealed.values.birthDate).not.toBe("1990-01-02")
    expect(sealed.encryptedColumns).toContain("birth_date")
    const opened = openModelValues({
      model: "User",
      rowId: "user-1",
      values: sealed.values,
      dek: sealed.dek,
      kek,
      encryptedColumns: sealed.encryptedColumns,
    })
    expect(opened.birthDate).toBe("1990-01-02")
  })

  it("fails decrypt when the authentication tag is tampered", () => {
    const sealed = sealModelValues({
      model: "ClothingItem",
      rowId: "piece-1",
      values: { imageUrl: "https://img" },
      kek,
      kekVersion: 1,
      lookupKey,
    })
    const payload = sealed.values.imageUrl
    if (!payload) throw new Error("expected ciphertext")
    const bytes = Buffer.from(payload, "base64")
    bytes[bytes.length - 1] ^= 0xff
    const tampered = bytes.toString("base64")

    expect(() =>
      openModelValues({
        model: "ClothingItem",
        rowId: "piece-1",
        values: { imageUrl: tampered },
        dek: sealed.dek,
        kek,
        encryptedColumns: ["image_url"],
      }),
    ).toThrow(/decrypt/i)
  })

  it("cannot recover an email from its lookup hash", () => {
    const hash = emailLookupCandidates("ada@example.com", [lookupKey])[0]
    expect(hash).not.toContain("ada@example.com")
    expect(Buffer.from(hash, "base64").toString("utf8")).not.toContain("ada@example.com")
    expect(hash).toBe(
      lookupHash({
        lookupKey,
        table: "users",
        column: "email",
        plaintext: "ada@example.com",
      }),
    )
    expect(
      encryptField({
        dek: lookupKey,
        table: "users",
        column: "email",
        rowId: "user-1",
        plaintext: "ada@example.com",
      }),
    ).not.toBe(hash)
    expect(() =>
      openModelValues({
        model: "User",
        rowId: "user-1",
        values: { email: hash },
        dek: hash,
        kek,
        encryptedColumns: ["email"],
      }),
    ).toThrow(/decrypt/i)
  })
})
