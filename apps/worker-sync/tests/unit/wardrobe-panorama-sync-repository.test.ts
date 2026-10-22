import { describe, it, expect, vi, beforeEach } from "vitest"
import { SqlWardrobePanoramaSyncRepository } from "../../src/lib/db/wardrobe-panorama.repository"
import { sealModelValues } from "../../src/lib/field-encryption/field-encryption"
import {
  LOCAL_ENCRYPTION_KEY_VERSION,
  LOCAL_KEK,
  LOCAL_LOOKUP_KEY,
} from "../../src/lib/field-encryption/local-encryption-keys"
import type postgres from "postgres"

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
    return []
  })
}

describe("SqlWardrobePanoramaSyncRepository", () => {
  beforeEach(() => {
    delete process.env.DEPLOYMENT_ENVIRONMENT
  })

  it("findTranslatableByUserId returns the first panorama row", async () => {
    const readDb = vi.fn().mockResolvedValue([
      { id: "panorama-1", content: "Analysis" },
    ]) as unknown as postgres.Sql
    const writeDb = vi.fn() as unknown as postgres.Sql
    const repo = new SqlWardrobePanoramaSyncRepository(readDb, writeDb)

    const result = await repo.findTranslatableByUserId("user-123")

    expect(result).toEqual({ id: "panorama-1", content: "Analysis" })
    const sql = getSqlStrings(readDb as unknown as ReturnType<typeof vi.fn>).join(" ")
    expect(sql).toContain("wardrobe_panorama")
  })

  it("decrypts a sealed panorama and returns legacy plaintext when dek is null", async () => {
    const sealed = sealModelValues({
      model: "WardrobePanorama",
      rowId: "panorama-sealed",
      values: { content: "Análise do guarda-roupa" },
      kek: LOCAL_KEK,
      kekVersion: LOCAL_ENCRYPTION_KEY_VERSION,
      lookupKey: LOCAL_LOOKUP_KEY,
    })
    const readDb = vi.fn().mockResolvedValue([
      {
        id: "panorama-sealed",
        content: sealed.values.content,
        dek: sealed.dek,
        kek_version: sealed.kekVersion,
        encrypted_columns: sealed.encryptedColumns,
      },
    ]) as unknown as postgres.Sql
    const repo = new SqlWardrobePanoramaSyncRepository(readDb, vi.fn() as unknown as postgres.Sql)
    await expect(repo.findTranslatableByUserId("user-1")).resolves.toEqual({
      id: "panorama-sealed",
      content: "Análise do guarda-roupa",
    })

    const legacy = vi.fn().mockResolvedValue([
      { id: "panorama-legacy", content: "Análise", dek: null, kek_version: null, encrypted_columns: [] },
    ]) as unknown as postgres.Sql
    await expect(
      new SqlWardrobePanoramaSyncRepository(legacy, vi.fn() as unknown as postgres.Sql).findTranslatableByUserId(
        "user-1",
      ),
    ).resolves.toEqual({ id: "panorama-legacy", content: "Análise" })
  })

  it("updateContent stores ciphertext and envelope columns", async () => {
    const readDb = vi.fn().mockResolvedValue([
      {
        id: "panorama-1",
        content: "Análise",
        dek: null,
        kek_version: null,
        encrypted_columns: [],
      },
    ]) as unknown as postgres.Sql
    const writeDb = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    const repo = new SqlWardrobePanoramaSyncRepository(readDb, writeDb)

    await repo.updateContent("panorama-1", "Wardrobe analysis")

    expect(writeDb).toHaveBeenCalledOnce()
    const writeMock = writeDb as unknown as ReturnType<typeof vi.fn>
    const sql = getSqlStrings(writeMock).join(" ")
    expect(sql).toContain("UPDATE wardrobe_panorama")
    expect(sql).toContain("dek")
    expect(sql).toContain("kek_version")
    expect(sql).toContain("encrypted_columns")
    const values = writeMock.mock.calls.flatMap((call) => call.slice(1))
    expect(values).not.toContain("Wardrobe analysis")
    expect(values).toContainEqual(["content", "created_by", "updated_by"])
  })
})
