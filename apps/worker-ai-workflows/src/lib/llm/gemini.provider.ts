import type { LlmProvider } from "./types"

const DEFAULT_MODEL = "gemini-2.5-flash"
const DEFAULT_API_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

interface GeminiRequestBody {
  contents: Array<{ parts: Array<{ text: string }> }>
  generationConfig: {
    temperature: number
    maxOutputTokens: number
  }
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
}

export class GeminiProvider implements LlmProvider {
  readonly name: string

  constructor() {
    const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL
    this.name = `gemini:${model}`
  }

  async generate(prompt: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error("GEMINI_API_KEY environment variable is not set")

    const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL
    const url = process.env.GEMINI_API_URL ?? DEFAULT_API_URL(model)

    const body: GeminiRequestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        // gemini-2.5-flash maximum output tokens (free tier and paid tier share this limit)
        maxOutputTokens: 65536,
      },
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gemini request failed: ${res.status} — ${text}`)
    }

    const json: GeminiResponse = await res.json()
    const candidate = json.candidates?.[0]

    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new Error(
        "LLM output was truncated (MAX_TOKENS). Reduce prompt size or increase maxOutputTokens.",
      )
    }

    const text = candidate?.content?.parts
      ?.map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")

    if (text && text.length > 0) return text

    // Fallback: return raw JSON so the caller can still attempt parsing
    return JSON.stringify(json)
  }
}
