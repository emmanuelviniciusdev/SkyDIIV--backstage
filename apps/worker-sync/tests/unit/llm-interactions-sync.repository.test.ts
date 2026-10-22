import type postgres from "postgres"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SqlLlmInteractionsRepository } from "../../src/lib/db/llm-interactions.repository"

function sqlText(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((part): part is string => typeof part === "string")
      return []
    })
    .join(" ")
}

describe("SqlLlmInteractionsRepository", () => {
  beforeEach(() => {
    delete process.env.DEPLOYMENT_ENVIRONMENT
  })

  it("stores prompt and response as ciphertext", async () => {
    const db = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql & ReturnType<typeof vi.fn>
    const repo = new SqlLlmInteractionsRepository(db)
    await repo.log({
      userId: "u1",
      model: "gemini",
      prompt: "Translate Análise",
      response: "Wardrobe analysis",
      status: "SUCCESS",
      latencyMs: 8,
    })

    const sql = sqlText(db)
    expect(sql).toMatch(/INSERT INTO llm_interactions/)
    expect(sql).toContain("dek")
    expect(sql).toContain("kek_version")
    expect(sql).toContain("encrypted_columns")
    const values = db.mock.calls.flatMap((call) => call.slice(1))
    expect(values).not.toContain("Translate Análise")
    expect(values).not.toContain("Wardrobe analysis")
    expect(values).toContainEqual(["prompt", "response", "created_by", "updated_by"])
  })
})
