import Database from 'better-sqlite3'
import { SqliteFamilyClient } from './sqlite-family'
import type { ConnectionConfig } from '../../shared/types'

export class SqliteClient extends SqliteFamilyClient {
  private db?: Database.Database

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    if (!this.config.file) throw new Error('Choose a SQLite file')
    this.db = new Database(this.config.file)
  }
  async disconnect() { this.db?.close() }

  private get d() {
    if (!this.db) throw new Error('Not connected')
    return this.db
  }


  protected async run(sql: string, params: unknown[] = []) {
    const stmt = this.d.prepare(sql)
    if (stmt.reader) {
      const rows = stmt.all(...params) as Record<string, unknown>[]
      return { columns: stmt.columns().map((c) => c.name), rows, affected: 0 }
    }
    const info = stmt.run(...params)
    return { columns: [], rows: [], affected: info.changes }
  }

  protected async transaction<T>(fn: () => Promise<T>) {
    this.d.exec('BEGIN')
    try {
      const r = await fn()
      this.d.exec('COMMIT')
      return r
    } catch (e) {
      this.d.exec('ROLLBACK')
      throw e
    }
  }

  // Catalog queries live in SqliteFamilyClient
}
