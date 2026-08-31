import { describe, it, expect, vi } from "vitest"
import { SqlWardrobePanoramaIdsRepository } from "../../src/lib/db/wardrobe-panorama-ids.repository"
import {
  GENERATE_SEARCH_TERMS_PRODUCTS_SCRAPING_EVENT_ID,
  SqlOutboxEventsRepository,
} from "../../src/lib/db/outbox-events.repository"

function getSqlStrings(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls
    .flatMap((call) => {
      const first = call[0]
      if (Array.isArray(first)) return first.filter((s): s is string => typeof s === "string")
      return []
    })
    .join(" ")
}

describe("SqlWardrobePanoramaIdsRepository", () => {
  it("returns an empty list when there are no panoramas", async () => {
    const db = vi.fn().mockResolvedValue([])
    const repo = new SqlWardrobePanoramaIdsRepository(db as never)
    await expect(repo.findAllIds()).resolves.toEqual([])
    expect(getSqlStrings(db)).toMatch(/SELECT id FROM wardrobe_panorama/)
  })

  it("returns every panorama id", async () => {
    const db = vi.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }])
    const repo = new SqlWardrobePanoramaIdsRepository(db as never)
    await expect(repo.findAllIds()).resolves.toEqual(["p1", "p2"])
  })
})

describe("SqlOutboxEventsRepository.insertGenerateSearchTerms", () => {
  it("inserts PENDING payload { wardrobePanoramaId }", async () => {
    const json = vi.fn((value: unknown) => value)
    const db = vi.fn().mockResolvedValue([])
    Object.assign(db, { json })
    const repo = new SqlOutboxEventsRepository(db as never)

    const id = await repo.insertGenerateSearchTerms({ wardrobePanoramaId: "p1" })

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    const sql = getSqlStrings(db)
    expect(sql).toMatch(/INSERT INTO outbox_events/)
    expect(db.mock.calls[0]).toContain("PENDING")
    expect(db.mock.calls[0]).toContain(GENERATE_SEARCH_TERMS_PRODUCTS_SCRAPING_EVENT_ID)
    expect(json).toHaveBeenCalledWith({ wardrobePanoramaId: "p1" })
  })
})
