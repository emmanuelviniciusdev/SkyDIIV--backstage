import type postgres from "postgres"
import { describe, it, expect, vi } from "vitest"
import { SqlFeedbacksAutomaticThriftingRepository } from "../../src/lib/db/feedbacks-automatic-thrifting.repository"
import { SqlSummariesFeedbacksAutomaticThriftingRepository } from "../../src/lib/db/summaries-feedbacks-automatic-thrifting.repository"

function makeSqlMock(rows: unknown[] = []): postgres.Sql & ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(rows) as unknown as postgres.Sql & ReturnType<typeof vi.fn>
}

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
      return []
    })
    .join(" ")
}

describe("SqlFeedbacksAutomaticThriftingRepository", () => {
  it("counts rows by user_id", async () => {
    const db = makeSqlMock([{ count: 3 }])
    const repo = new SqlFeedbacksAutomaticThriftingRepository(db)
    await expect(repo.countByUserId("u1")).resolves.toBe(3)
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/FROM feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/user_id/)
    expect(db.mock.calls[0]?.[1]).toBe("u1")
  })

  it("loads at most maxEntries most recent rows", async () => {
    const createdAt = new Date("2026-09-01T00:00:00.000Z")
    const db = makeSqlMock([
      {
        id: "f1",
        user_id: "u1",
        scraped_product_id: "p1",
        liked: true,
        reason: "nice",
        json_search: { term: "blazer" },
        json_result: { marketplace: "enjoei" },
        json_listed_product: { title: "blazer" },
        created_at: createdAt,
      },
    ])
    const repo = new SqlFeedbacksAutomaticThriftingRepository(db)
    const rows = await repo.findMostRecentByUserId("u1", 250)
    expect(rows).toEqual([
      {
        id: "f1",
        userId: "u1",
        scrapedProductId: "p1",
        liked: true,
        reason: "nice",
        jsonSearch: { term: "blazer" },
        jsonResult: { marketplace: "enjoei" },
        jsonListedProduct: { title: "blazer" },
        createdAt,
      },
    ])
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/FROM feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/)
    expect(sql).toMatch(/LIMIT/)
    expect(db.mock.calls[0]?.[1]).toBe("u1")
    expect(db.mock.calls[0]?.[2]).toBe(250)
  })
})

describe("SqlSummariesFeedbacksAutomaticThriftingRepository", () => {
  it("finds a summary by user_id", async () => {
    const updatedAt = new Date("2026-09-07T00:00:00.000Z")
    const db = makeSqlMock([
      {
        id: "s1",
        user_id: "u1",
        summary: "likes blazers",
        outdated: false,
        updated_at: updatedAt,
      },
    ])
    const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)
    await expect(repo.findByUserId("u1")).resolves.toEqual({
      id: "s1",
      userId: "u1",
      summary: "likes blazers",
      outdated: false,
      updatedAt,
    })
    expect(getSqlStrings(db)).toMatch(/FROM summaries_feedbacks_automatic_thrifting/)
  })

  it("inserts a sealed summary when the row is missing", async () => {
    const db = makeSqlMock([])
    const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)
    const readAt = new Date("2026-09-07T12:00:00.000Z")
    await repo.upsertSummary({ userId: "u1", summary: "new", readAt })
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/INSERT INTO summaries_feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/dek/)
    expect(sql).toMatch(/kek_version/)
    expect(sql).toMatch(/encrypted_columns/)
    expect(sql).not.toMatch(/ON CONFLICT/)
    const bound = db.mock.calls.flat().filter((v) => typeof v === "string" || Array.isArray(v))
    expect(bound).not.toContain("worker-ai-workflows")
    expect(bound).not.toContain("new")
    expect(bound).toContainEqual(["summary", "created_by", "updated_by"])
  })

  it("updates a sealed summary and keeps the outdated CAS", async () => {
    const updatedAt = new Date("2026-09-01T00:00:00.000Z")
    const db = vi.fn()
      .mockResolvedValueOnce([
        {
          id: "s1",
          user_id: "u1",
          summary: "old",
          outdated: true,
          updated_at: updatedAt,
          dek: null,
          kek_version: null,
          encrypted_columns: [],
        },
      ])
      .mockResolvedValueOnce([]) as unknown as postgres.Sql & ReturnType<typeof vi.fn>
    const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)
    const readAt = new Date("2026-09-07T12:00:00.000Z")
    await repo.upsertSummary({ userId: "u1", summary: "likes blazers", readAt })
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/UPDATE summaries_feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/outdated/)
    expect(sql).toMatch(/updated_at <=/)
    expect(sql).toMatch(/dek/)
    expect(sql).not.toMatch(/ON CONFLICT/)
    const bound = db.mock.calls.flat().filter((v) => typeof v === "string" || Array.isArray(v))
    expect(bound).not.toContain("likes blazers")
    expect(bound).toContainEqual(["summary", "created_by", "updated_by"])
  })

  it("stores a sealed empty string and returns it as plaintext on a later find", async () => {
    const updatedAt = new Date("2026-09-01T00:00:00.000Z")
    const readAt = new Date("2026-09-07T12:00:00.000Z")
    let stored: {
      id: string
      user_id: string
      summary: string
      outdated: boolean
      updated_at: Date
      dek: string
      kek_version: number
      encrypted_columns: string[]
      created_by: string | null
      updated_by: string | null
    } | null = null
    const db = vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join(" ")
      if (sql.includes("SELECT")) return Promise.resolve(stored ? [stored] : [])
      const summary = values.find((value) => typeof value === "string" && value !== "u1" && value !== "s1" && value !== "worker-ai-workflows")
      const dek = values.find((value) => typeof value === "string" && value !== summary && value !== "u1" && value !== "s1" && value !== "worker-ai-workflows")
      const columns = values.find((value) => Array.isArray(value))
      stored = {
        id: "s1",
        user_id: "u1",
        summary: String(summary),
        outdated: false,
        updated_at: updatedAt,
        dek: String(dek),
        kek_version: 1,
        encrypted_columns: columns as string[],
        created_by: null,
        updated_by: null,
      }
      return Promise.resolve([])
    }) as unknown as postgres.Sql
    const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)
    await repo.clearStaleEmpty({ userId: "u1", readAt })
    expect(stored).toBeNull()

    stored = {
      id: "s1",
      user_id: "u1",
      summary: "stale",
      outdated: true,
      updated_at: updatedAt,
      dek: "",
      kek_version: 1,
      encrypted_columns: [],
      created_by: "worker-ai-workflows",
      updated_by: "worker-ai-workflows",
    }
    const seeded = {
      id: "s1",
      user_id: "u1",
      summary: "stale",
      outdated: true,
      updated_at: updatedAt,
      dek: null,
      kek_version: null,
      encrypted_columns: [] as string[],
    }
    const scripted = vi.fn()
      .mockResolvedValueOnce([seeded])
      .mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        const summary = values[0]
        const dek = values[1]
        const kekVersion = values[2]
        const columns = values[3]
        stored = {
          id: "s1",
          user_id: "u1",
          summary: String(summary),
          outdated: false,
          updated_at: updatedAt,
          dek: String(dek),
          kek_version: Number(kekVersion),
          encrypted_columns: columns as string[],
          created_by: String(values[4]),
          updated_by: String(values[5]),
        }
        return Promise.resolve([])
      }) as unknown as postgres.Sql
    const writing = new SqlSummariesFeedbacksAutomaticThriftingRepository(scripted)
    await writing.clearStaleEmpty({ userId: "u1", readAt })
    const sql = getSqlStrings(scripted)
    expect(sql).toMatch(/UPDATE summaries_feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/outdated = true/)
    expect(sql).toMatch(/updated_at <=/)
    expect(sql).not.toMatch(/SET summary = ''/)
    expect(stored?.summary).not.toBe("")
    expect(stored?.encrypted_columns).toEqual(["summary", "created_by", "updated_by"])

    const reader = makeSqlMock([stored])
    const found = await new SqlSummariesFeedbacksAutomaticThriftingRepository(reader).findByUserId("u1")
    expect(found?.summary).toBe("")
  })
})
