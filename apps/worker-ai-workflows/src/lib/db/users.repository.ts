import type postgres from "postgres"

export interface UserProfile {
  firstName: string
  lastName: string
}

export interface UsersRepository {
  findByUserId(userId: string): Promise<UserProfile | null>
}

interface UserRow {
  first_name: string
  last_name: string
}

export class SqlUsersRepository implements UsersRepository {
  constructor(private readonly db: postgres.Sql) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const rows = await this.db<UserRow[]>`
      SELECT first_name, last_name
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      firstName: row.first_name,
      lastName: row.last_name,
    }
  }
}
