import type postgres from "postgres"
import { createListedRowOpener } from "../field-encryption/open-seal"

export interface UserProfile {
  preferredName: string | null
  firstName: string
  lastName: string
}

export interface UsersRepository {
  findByUserId(userId: string): Promise<UserProfile | null>
}

interface UserRow {
  id: string
  preferred_name: string | null
  first_name: string
  last_name: string
  dek: string | null
  kek_version: number | null
  encrypted_columns: string[] | null
}

/**
 * Resolves the display name for prompts: preferred_name when set,
 * otherwise first + last name. Returns "" when nothing is available.
 */
export function resolveUserDisplayName(user: UserProfile | null | undefined): string {
  if (!user) return ""

  const preferred = user.preferredName?.trim()
  if (preferred) return preferred

  return [user.firstName, user.lastName]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ")
}

export class SqlUsersRepository implements UsersRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const rows = await this.db<UserRow[]>`
      SELECT id, preferred_name, first_name, last_name, dek, kek_version, encrypted_columns
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    const open = createListedRowOpener()
    const opened = await open({
      model: "User",
      rowId: row.id,
      values: {
        preferredName: row.preferred_name,
        firstName: row.first_name,
        lastName: row.last_name,
      },
      dek: row.dek,
      kekVersion: row.kek_version,
      encryptedColumns: row.encrypted_columns,
    })
    return {
      preferredName: opened.preferredName ?? null,
      firstName: opened.firstName ?? "",
      lastName: opened.lastName ?? "",
    }
  }
}
