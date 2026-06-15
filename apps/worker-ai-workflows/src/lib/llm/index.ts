import { GeminiProvider } from "./gemini.provider"
import type { LlmProvider, LlmProviderFactory } from "./types"

export type { LlmProvider, LlmProviderFactory } from "./types"

const registry = new Map<string, LlmProviderFactory>()

registry.set("gemini_flash", () => new GeminiProvider())

/**
 * Returns the registered LLM provider.
 * Resolution order: explicit `name` arg → LLM_PROVIDER env → "gemini_flash".
 */
export function getLlmProvider(name?: string): LlmProvider {
  const key = name ?? process.env.LLM_PROVIDER ?? "gemini_flash"
  const factory = registry.get(key)
  if (!factory) throw new Error(`LLM provider "${key}" is not registered`)
  return factory()
}

/** Registers a custom LLM provider — useful for testing. */
export function registerLlmProvider(name: string, factory: LlmProviderFactory): void {
  registry.set(name, factory)
}
