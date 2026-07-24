import postgres from "postgres"

/**
 * Two separate postgres.js connection pools:
 *
 * readDb  → DATABASE_URL  (pgbouncer / pooler endpoint) — SELECTs
 * writeDb → DATABASE_URL_UNPOOLED (direct endpoint) — writes / transactions
 */

export interface DbClients {
  readDb: postgres.Sql
  writeDb: postgres.Sql
}

export function createDbClients(env: {
  databaseUrl: string
  databaseUrlUnpooled?: string
}): DbClients {
  const readDb = postgres(env.databaseUrl, { max: 5 })
  const writeDb = postgres(env.databaseUrlUnpooled ?? env.databaseUrl, { max: 5 })
  return { readDb, writeDb }
}

export async function closeDbClients(clients: DbClients): Promise<void> {
  await Promise.all([clients.readDb.end({ timeout: 5 }), clients.writeDb.end({ timeout: 5 })])
}
