export interface LlmProvider {
  /** Unique key identifying this provider (stored in llm_interactions.model). */
  readonly name: string
  /**
   * Sends the prompt to the model and returns the raw text response.
   * Throws on network errors or non-OK status codes.
   */
  generate(prompt: string): Promise<string>
}

export type LlmProviderFactory = () => LlmProvider
