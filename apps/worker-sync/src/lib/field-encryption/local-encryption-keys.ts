import { decodeAesKey } from "./field-encryption"

/**
 * Fixed envelope keys for local development and automated tests.
 * Production and staging load keys from Cloudflare D1. These values are not secret.
 */

/** KEK and lookup key version for the local adapter (always 1). */
export const LOCAL_ENCRYPTION_KEY_VERSION = 1

/** Standard base64 of 32×0x11 — AES-256 KEK for local / test. */
export const LOCAL_KEK_BASE64 = "ERERERERERERERERERERERERERERERERERERERERERE="

/** Standard base64 of 32×0x22 — HMAC lookup key for local / test. */
export const LOCAL_LOOKUP_KEY_BASE64 = "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI="

export const LOCAL_KEK = decodeAesKey(LOCAL_KEK_BASE64)
export const LOCAL_LOOKUP_KEY = decodeAesKey(LOCAL_LOOKUP_KEY_BASE64)

/**
 * Local test vectors when `DEPLOYMENT_ENVIRONMENT` is `local` or unset.
 * `production` and `staging` load Cloudflare D1. There is no `ENCRYPTION_KEY_SOURCE` switch.
 */
export function useLocalEncryptionKeys(env: NodeJS.ProcessEnv): boolean {
  const deployment = readEnv(env, "DEPLOYMENT_ENVIRONMENT")
  return deployment !== "production" && deployment !== "staging"
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}
