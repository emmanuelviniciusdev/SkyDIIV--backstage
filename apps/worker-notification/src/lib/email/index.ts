import { ResendProvider } from "./resend.provider"
import type { EmailProvider, EmailProviderFactory } from "./types"

export type { EmailProvider, EmailProviderFactory, SendEmailInput, SendEmailResult } from "./types"

const registry = new Map<string, EmailProviderFactory>()

registry.set("resend", () => new ResendProvider())

/**
 * Returns the registered transactional email provider.
 * Resolution order: explicit `name` arg → EMAIL_PROVIDER env → "resend".
 */
export function getEmailProvider(name?: string): EmailProvider {
  const key = name ?? process.env.EMAIL_PROVIDER ?? "resend"
  const factory = registry.get(key)
  if (!factory) throw new Error(`Email provider "${key}" is not registered`)
  return factory()
}

/** Registers a custom email provider — useful for testing or new backends. */
export function registerEmailProvider(name: string, factory: EmailProviderFactory): void {
  registry.set(name, factory)
}
