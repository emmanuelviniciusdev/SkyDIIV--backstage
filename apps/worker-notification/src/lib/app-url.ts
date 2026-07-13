const DEFAULT_APP_URL = "https://skydiiv.space"

/**
 * Public base URL of the SkyDIIV web app, used to build CTA links in emails.
 * Resolution order: APP_URL env → NEXT_PUBLIC_SITE_URL env → https://skydiiv.space.
 * A trailing slash (if any) is stripped so callers can safely append paths.
 */
export function resolveAppUrl(): string {
  const raw = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const base = raw && raw.length > 0 ? raw : DEFAULT_APP_URL
  return base.replace(/\/+$/, "")
}
