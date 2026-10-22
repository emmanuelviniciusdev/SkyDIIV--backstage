import type postgres from "postgres"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SqlFeedbacksAutomaticThriftingRepository } from "../../src/lib/db/feedbacks-automatic-thrifting.repository"
import { SqlLlmInteractionsRepository } from "../../src/lib/db/llm-interactions.repository"
import { SqlPreferencesRepository } from "../../src/lib/db/preferences.repository"
import { SqlShoppingSuggestionsPreferencesRepository } from "../../src/lib/db/shopping-suggestions-preferences.repository"
import { SqlUsersRepository } from "../../src/lib/db/users.repository"
import { SqlWardrobePanoramaRepository } from "../../src/lib/db/wardrobe-panorama.repository"
import { SqlWardrobeRepository } from "../../src/lib/db/wardrobe.repository"
import { sealModelValues } from "../../src/lib/field-encryption/field-encryption"
import {
  LOCAL_ENCRYPTION_KEY_VERSION,
  LOCAL_KEK,
  LOCAL_LOOKUP_KEY,
} from "../../src/lib/field-encryption/local-encryption-keys"

function makeSqlMock(rows: unknown[] = []): postgres.Sql & ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql & ReturnType<typeof vi.fn>
}

function sqlText(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((part): part is string => typeof part === "string")
      return []
    })
    .join(" ")
}

function boundValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls.flatMap((call) => {
    const first = call[0]
    if (Array.isArray(first)) return call.slice(1)
    return []
  })
}

function seal(model: string, rowId: string, values: Record<string, string | null>) {
  return sealModelValues({
    model,
    rowId,
    values,
    kek: LOCAL_KEK,
    kekVersion: LOCAL_ENCRYPTION_KEY_VERSION,
    lookupKey: LOCAL_LOOKUP_KEY,
  })
}

describe("sealed repository reads", () => {
  beforeEach(() => {
    delete process.env.DEPLOYMENT_ENVIRONMENT
  })

  it("returns plaintext names for a sealed user and for a legacy row", async () => {
    const sealed = seal("User", "user-1", {
      firstName: "Ana",
      lastName: "Costa",
      preferredName: "Aninha",
    })
    const sealedDb = makeSqlMock([
      {
        id: "user-1",
        first_name: sealed.values.firstName,
        last_name: sealed.values.lastName,
        preferred_name: sealed.values.preferredName,
        dek: sealed.dek,
        kek_version: sealed.kekVersion,
        encrypted_columns: sealed.encryptedColumns,
      },
    ])
    await expect(new SqlUsersRepository(sealedDb).findByUserId("user-1")).resolves.toEqual({
      firstName: "Ana",
      lastName: "Costa",
      preferredName: "Aninha",
    })

    const legacyDb = makeSqlMock([
      {
        id: "user-2",
        first_name: "Maria",
        last_name: "Silva",
        preferred_name: null,
        dek: null,
        kek_version: null,
        encrypted_columns: [],
      },
    ])
    await expect(new SqlUsersRepository(legacyDb).findByUserId("user-2")).resolves.toEqual({
      firstName: "Maria",
      lastName: "Silva",
      preferredName: null,
    })
  })

  it("returns plaintext location and routine for sealed and legacy preferences", async () => {
    const sealed = seal("WeeklyOutfitPreferences", "prefs-1", {
      location: "São Paulo, São Paulo, Brasil",
      routineDescription: "escritório",
    })
    const sealedDb = makeSqlMock([
      {
        id: "prefs-1",
        user_id: "user-1",
        location: sealed.values.location,
        routine_description: sealed.values.routineDescription,
        dek: sealed.dek,
        kek_version: sealed.kekVersion,
        encrypted_columns: sealed.encryptedColumns,
      },
    ])
    await expect(new SqlPreferencesRepository(sealedDb).findByUserId("user-1")).resolves.toEqual({
      id: "prefs-1",
      userId: "user-1",
      location: "São Paulo, São Paulo, Brasil",
      routineDescription: "escritório",
    })

    const legacyDb = makeSqlMock([
      {
        id: "prefs-2",
        user_id: "user-2",
        location: "Rio",
        routine_description: "home",
        dek: null,
        kek_version: null,
        encrypted_columns: null,
      },
    ])
    await expect(new SqlPreferencesRepository(legacyDb).findByUserId("user-2")).resolves.toMatchObject({
      location: "Rio",
      routineDescription: "home",
    })
  })

  it("returns plaintext sizes and gender and leaves unrelated columns alone", async () => {
    const sealed = seal("ShoppingSuggestionsPreferences", "shop-1", {
      gender: "Female",
      topSize: "M",
      bottomSize: null,
      footSize: "38",
    })
    const db = makeSqlMock([
      {
        id: "shop-1",
        gender: sealed.values.gender,
        top_size: sealed.values.topSize,
        bottom_size: null,
        foot_size: sealed.values.footSize,
        dek: sealed.dek,
        kek_version: sealed.kekVersion,
        encrypted_columns: sealed.encryptedColumns,
      },
    ])
    await expect(new SqlShoppingSuggestionsPreferencesRepository(db).findByUserId("user-1")).resolves.toEqual({
      gender: "Female",
      topSize: "M",
      bottomSize: null,
      footSize: "38",
    })
    expect(sealed.encryptedColumns).not.toContain("bottom_size")
  })

  it("decrypts clothing image urls and leaves title and tag names unchanged", async () => {
    const sealed = seal("ClothingItem", "item-1", { imageUrl: "https://r2.example/shirt.jpg" })
    const db = makeSqlMock([
      {
        id: "item-1",
        title: "Linen shirt",
        image_url: sealed.values.imageUrl,
        tags: ["linen"],
        piece_type: "Top",
        piece_subtype: "Shirt",
        dek: sealed.dek,
        kek_version: sealed.kekVersion,
        encrypted_columns: sealed.encryptedColumns,
      },
    ])
    const [item] = await new SqlWardrobeRepository(db).findByUserId("user-1")
    expect(item?.imageUrl).toBe("https://r2.example/shirt.jpg")
    expect(item?.title).toBe("Linen shirt")
    expect(item?.tags).toEqual(["linen"])
    expect(sealed.values.imageUrl).not.toBe("https://r2.example/shirt.jpg")
  })

  it("decrypts feedback reasons and leaves json payload fields unchanged", async () => {
    const sealed = seal("FeedbackAutomaticThrifting", "f1", { reason: "likes blazers" })
    const db = makeSqlMock([
      {
        id: "f1",
        user_id: "u1",
        scraped_product_id: "p1",
        liked: true,
        reason: sealed.values.reason,
        json_search: { gender: "Female", topSize: "M" },
        json_result: { title: "blazer" },
        json_listed_product: { title: "listed" },
        created_at: new Date("2026-09-01T00:00:00.000Z"),
        dek: sealed.dek,
        kek_version: sealed.kekVersion,
        encrypted_columns: sealed.encryptedColumns,
      },
    ])
    const [row] = await new SqlFeedbacksAutomaticThriftingRepository(db).findMostRecentByUserId("u1", 10)
    expect(row?.reason).toBe("likes blazers")
    expect(row?.jsonSearch).toEqual({ gender: "Female", topSize: "M" })
    expect(sealed.values.reason).not.toBe("likes blazers")
  })

  it("returns legacy panorama plaintext and decrypted sealed content, including an empty string", async () => {
    const legacyDb = makeSqlMock([
      { id: "p-legacy", user_id: "u1", content: "# Old", dek: null, kek_version: null, encrypted_columns: [] },
    ])
    await expect(new SqlWardrobePanoramaRepository(legacyDb).findById("p-legacy")).resolves.toEqual({
      id: "p-legacy",
      userId: "u1",
      content: "# Old",
    })

    const empty = seal("WardrobePanorama", "p-empty", { content: "" })
    const sealedDb = makeSqlMock([
      {
        id: "p-empty",
        user_id: "u1",
        content: empty.values.content,
        dek: empty.dek,
        kek_version: empty.kekVersion,
        encrypted_columns: empty.encryptedColumns,
      },
    ])
    const found = await new SqlWardrobePanoramaRepository(sealedDb).findById("p-empty")
    expect(found?.content).toBe("")
    expect(empty.values.content).not.toBe("")
  })
})

describe("sealed repository writes", () => {
  beforeEach(() => {
    delete process.env.DEPLOYMENT_ENVIRONMENT
  })

  it("allocates the llm row id before sealing and omits null client_prompt", async () => {
    const db = makeSqlMock([])
    const repo = new SqlLlmInteractionsRepository(db)
    const id = await repo.logAndReturnId({
      userId: "u1",
      model: "gemini",
      prompt: "Hello Ana",
      response: "markdown",
      status: "SUCCESS",
      latencyMs: 12,
    })

    const sql = sqlText(db)
    expect(sql).toMatch(/INSERT INTO llm_interactions/)
    expect(sql).toMatch(/dek/)
    expect(sql).toMatch(/kek_version/)
    expect(sql).toMatch(/encrypted_columns/)
    const values = boundValues(db)
    expect(values).toContain(id)
    expect(values).not.toContain("Hello Ana")
    expect(values).not.toContain("markdown")
    expect(values).toContainEqual(["prompt", "response", "created_by", "updated_by"])
    expect(values).not.toContainEqual(expect.arrayContaining(["client_prompt"]))
  })

  it("does not insert llm plaintext when the key store is unavailable", async () => {
    const names = [
      "DEPLOYMENT_ENVIRONMENT",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID",
      "CLOUDFLARE_D1_API_TOKEN",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "REDIS_URL",
    ] as const
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
    try {
      for (const name of names) delete process.env[name]
      process.env.DEPLOYMENT_ENVIRONMENT = "production"
      const db = makeSqlMock([])
      const repo = new SqlLlmInteractionsRepository(db)
      await expect(
        repo.logAndReturnId({
          userId: "u1",
          model: "gemini",
          prompt: "secret",
          status: "SUCCESS",
          latencyMs: 1,
        }),
      ).rejects.toThrow(/unavailable/i)
      expect(db).not.toHaveBeenCalled()
    } finally {
      for (const name of names) {
        if (saved[name] === undefined) delete process.env[name]
        else process.env[name] = saved[name]
      }
    }
  })

  it("inserts sealed panorama content and re-seals it on update", async () => {
    const db = makeSqlMock([])
    const repo = new SqlWardrobePanoramaRepository(db, db)
    await repo.saveOrUpdate({ userId: "u1", content: "# Wardrobe", llmInteractionId: "llm-1" })
    const insertSql = sqlText(db)
    expect(insertSql).toMatch(/INSERT INTO wardrobe_panorama/)
    expect(insertSql).toMatch(/dek/)
    expect(insertSql).toMatch(/encrypted_columns/)
    expect(boundValues(db)).not.toContain("# Wardrobe")
    expect(boundValues(db)).toContainEqual(["content", "created_by", "updated_by"])

    const existing = seal("WardrobePanorama", "p1", { content: "# Old" })
    const updateDb = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(" ")
      if (sql.includes("SELECT")) {
        return Promise.resolve([
          {
            id: "p1",
            user_id: "u1",
            content: existing.values.content,
            dek: existing.dek,
            kek_version: existing.kekVersion,
            encrypted_columns: existing.encryptedColumns,
          },
        ])
      }
      return Promise.resolve([])
    }) as unknown as postgres.Sql & ReturnType<typeof vi.fn>
    await new SqlWardrobePanoramaRepository(updateDb).saveOrUpdate({
      userId: "u1",
      content: "# Wardrobe",
    })
    expect(sqlText(updateDb)).toMatch(/UPDATE wardrobe_panorama/)
    expect(boundValues(updateDb)).not.toContain("# Wardrobe")
    expect(boundValues(updateDb)).toContainEqual(["content", "created_by", "updated_by"])
  })
})
