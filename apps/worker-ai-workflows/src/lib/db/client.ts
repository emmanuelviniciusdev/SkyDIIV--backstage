import postgres from "postgres"

/**
 * Two separate postgres.js connection pools:
 *
 * readDb  → DATABASE_URL  (pgbouncer / pooler endpoint)
 *           Used for all SELECT queries.
 *
 * writeDb → DATABASE_URL_UNPOOLED (direct endpoint)
 *           Used for INSERT/UPDATE/DELETE and sql.begin() transactions.
 *           Direct connections are required for multi-statement transactions
 *           because pgbouncer in transaction-pooling mode does not support
 *           persistent transaction state across statements.
 *
 * postgres.js auto-detects the runtime:
 *   • Local dev (wrangler dev / Node.js) → Node.js `net` TCP sockets
 *   • Cloudflare Workers production       → `cloudflare:sockets` TCP API
 *
 * Singletons are initialised lazily so they pick up process.env values that
 * src/index.ts copies from CF Worker bindings before the first request.
 */

let _readDb: postgres.Sql | null = null
let _writeDb: postgres.Sql | null = null

export function getReadDb(): postgres.Sql {
  if (!_readDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL environment variable is not set")
    _readDb = postgres(url, { max: 1 })
  }
  return _readDb
}

export function getWriteDb(): postgres.Sql {
  if (!_writeDb) {
    const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL_UNPOOLED environment variable is not set")
    _writeDb = postgres(url, { max: 1 })
  }
  return _writeDb
}

/** Resets singletons. Call between requests in tests or when env changes. */
export function resetDbClients(): void {
  _readDb = null
  _writeDb = null
}
