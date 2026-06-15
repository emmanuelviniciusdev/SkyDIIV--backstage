import postgres from "postgres"

/**
 * Single postgres.js connection pool for read-only queries.
 *
 * DATABASE_URL should point to the pooled/pgbouncer endpoint (Neon).
 * This service only reads weekly_outfit_preferences — no writes needed.
 *
 * postgres.js auto-detects the runtime:
 *   • Local dev (wrangler dev / Node.js) → Node.js `net` TCP sockets
 *   • Cloudflare Workers production       → `cloudflare:sockets` TCP API
 *
 * Singleton is initialised lazily so it picks up process.env values that
 * src/index.ts copies from CF Worker bindings before the first request.
 */

let _db: postgres.Sql | null = null

export function getDb(): postgres.Sql {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL environment variable is not set")
    _db = postgres(url, { max: 1 })
  }
  return _db
}

/** Resets the singleton. Call between requests in tests or when env changes. */
export function resetDbClient(): void {
  _db = null
}
