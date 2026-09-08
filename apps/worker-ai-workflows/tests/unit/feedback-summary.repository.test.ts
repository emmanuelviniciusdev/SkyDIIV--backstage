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

  it("upserts summary with CAS on outdated and updated_at", async () => {
    const db = makeSqlMock([])
    const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)
    const readAt = new Date("2026-09-07T12:00:00.000Z")
    await repo.upsertSummary({ userId: "u1", summary: "new", readAt })
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/INSERT INTO summaries_feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/ON CONFLICT \(user_id\)/)
    expect(sql).toMatch(/outdated/)
    expect(sql).toMatch(/created_by/)
    const bound = db.mock.calls.flat().filter((v) => typeof v === "string")
    expect(bound).toContain("worker-ai-workflows")
    expect(sql).toMatch(/updated_at <=/)
  })

  it("clears a stale empty row only when outdated and updated_at is not newer", async () => {
    const db = makeSqlMock([])
    const repo = new SqlSummariesFeedbacksAutomaticThriftingRepository(db)
    const readAt = new Date("2026-09-07T12:00:00.000Z")
    await repo.clearStaleEmpty({ userId: "u1", readAt })
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/UPDATE summaries_feedbacks_automatic_thrifting/)
    expect(sql).toMatch(/outdated = true/)
    expect(sql).toMatch(/updated_at <=/)
    expect(sql).not.toMatch(/INSERT/)
  })
})
