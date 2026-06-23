import { describe, it, expect } from "vitest"
import { z } from "zod"
import { parseJsonResponse, stripMarkdownFences } from "../../src/lib/prompt/parse"

describe("stripMarkdownFences", () => {
  it("removes json code fences", () => {
    expect(stripMarkdownFences("```json\n{\"ok\":true}\n```")).toBe('{"ok":true}')
  })
})

describe("parseJsonResponse", () => {
  const schema = z.object({ id: z.string(), content: z.string() })

  it("parses fenced JSON through the schema", () => {
    const result = parseJsonResponse(
      '```json\n{"id":"abc","content":"hello"}\n```',
      schema,
      "test",
    )
    expect(result).toEqual({ id: "abc", content: "hello" })
  })

  it("throws when JSON is invalid", () => {
    expect(() => parseJsonResponse("not-json", schema, "test")).toThrow(
      "test response is not valid JSON",
    )
  })
})
