import { describe, it, expect, vi } from "vitest"
import type { FeedbackAutomaticThriftingRow } from "../../src/lib/db/feedbacks-automatic-thrifting.repository"
import { foldFeedbackSummaryChunks } from "../../src/lib/automatic-thrifting/fold-feedback-summary"
import {
  SUMMARIZER_NON_EXCLUSIVE_INSTRUCTION,
  SUMMARIZER_TENDENCY_INSTRUCTION,
  buildSummarizeAutomaticThriftingFeedbackPrompt,
} from "../../src/lib/i18n/prompts/summarize-automatic-thrifting-feedback"
import { parseFeedbackSummaryLlmOutput } from "../../src/lib/prompt/feedback-summary-response"

function makeEnjoeiRow(
  index: number,
  createdAt: Date,
): FeedbackAutomaticThriftingRow {
  return {
    id: `f-${index}`,
    userId: "u1",
    scrapedProductId: `sp-${index}`,
    liked: index % 2 === 0,
    reason: index % 5 === 0 ? "ok" : null,
    jsonSearch: { term: `term-${index}`, gender: "Female", topSize: "M", bottomSize: null, footSize: null },
    jsonResult: {
      marketplace: "enjoei",
      title: `title-${index}`,
      price: index,
      currency: "BRL",
      url: `https://www.enjoei.com.br/p/${index}`,
      image_url: `https://photos.enjoei.com.br/${index}.png`,
      metadata: { size: "M" },
    },
    jsonListedProduct: {
      marketplace: "enjoei",
      title: `title-${index}`,
      searchTerm: `term-${index}`,
    },
    createdAt,
  }
}

function newestFirst(count: number): FeedbackAutomaticThriftingRow[] {
  const rows: FeedbackAutomaticThriftingRow[] = []
  for (let i = 0; i < count; i++) {
    rows.push(makeEnjoeiRow(i, new Date(Date.UTC(2026, 0, 1 + i))))
  }
  return [...rows].reverse()
}

describe("buildSummarizeAutomaticThriftingFeedbackPrompt", () => {
  it("forbids exclusive wording and asks for tendencies", () => {
    const prompt = buildSummarizeAutomaticThriftingFeedbackPrompt({
      locale: "pt-BR",
      priorSummary: "",
      records: [
        {
          marketplace: "enjoei",
          liked: true,
          reason: null,
          title: "camisa",
          price: 10,
          currency: "BRL",
          size: "M",
          searchTerm: "camisa",
          gender: "Male",
          topSize: "M",
          bottomSize: null,
          footSize: null,
        },
      ],
    })
    expect(prompt).toContain(SUMMARIZER_TENDENCY_INSTRUCTION)
    expect(prompt).toContain(SUMMARIZER_NON_EXCLUSIVE_INSTRUCTION)
    expect(prompt).toContain("Responda sempre em português brasileiro")
  })
})

describe("parseFeedbackSummaryLlmOutput", () => {
  it("rejects a blank string", () => {
    expect(() => parseFeedbackSummaryLlmOutput("   ")).toThrow(/empty/)
  })
})

describe("foldFeedbackSummaryChunks", () => {
  it("makes one LLM call for 20 Enjoei rows with default chunk 50", async () => {
    const generate = vi.fn().mockResolvedValue("resumo 20")
    const summary = await foldFeedbackSummaryChunks({
      rowsNewestFirst: newestFirst(20),
      maxEntries: 250,
      chunkSize: 50,
      locale: "pt-BR",
      generate,
    })
    expect(generate).toHaveBeenCalledOnce()
    expect(summary).toBe("resumo 20")
    const prompt = generate.mock.calls[0]?.[0] as string
    expect(prompt).toContain("term-0")
    expect(prompt).toContain("term-19")
    expect(prompt).not.toMatch(/json_search|json_result|json_listed_product/)
    expect(prompt).not.toMatch(/https:\/\/www\.enjoei/)
    expect(prompt).not.toMatch(/image_url/)
  })

  it("folds 120 rows in three calls of 50 with the running summary", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("s1")
      .mockResolvedValueOnce("s2")
      .mockResolvedValueOnce("s3")
    const summary = await foldFeedbackSummaryChunks({
      rowsNewestFirst: newestFirst(120),
      maxEntries: 250,
      chunkSize: 50,
      locale: "pt-BR",
      generate,
    })
    expect(generate).toHaveBeenCalledTimes(3)
    expect(summary).toBe("s3")
    expect(generate.mock.calls[1]?.[0]).toContain("s1")
    expect(generate.mock.calls[2]?.[0]).toContain("s2")
  })

  it("never sends the oldest 50 of 300 when maxEntries is 250", async () => {
    const generate = vi.fn().mockImplementation(async (prompt: string) => {
      expect(prompt).not.toContain("term-0")
      expect(prompt).not.toContain("term-49")
      expect(prompt).toContain("term-50")
      expect(prompt).toContain("term-299")
      return "ok"
    })
    await foldFeedbackSummaryChunks({
      rowsNewestFirst: newestFirst(300),
      maxEntries: 250,
      chunkSize: 250,
      locale: "pt-BR",
      generate,
    })
    expect(generate).toHaveBeenCalledOnce()
  })

  it("makes three calls for 25 rows with chunk size 10", async () => {
    const generate = vi.fn().mockResolvedValue("x")
    await foldFeedbackSummaryChunks({
      rowsNewestFirst: newestFirst(25),
      maxEntries: 250,
      chunkSize: 10,
      locale: "pt-BR",
      generate,
    })
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it("rethrows LLM errors", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("gemini down"))
    await expect(
      foldFeedbackSummaryChunks({
        rowsNewestFirst: newestFirst(2),
        maxEntries: 250,
        chunkSize: 50,
        locale: "pt-BR",
        generate,
      }),
    ).rejects.toThrow("gemini down")
  })
})
