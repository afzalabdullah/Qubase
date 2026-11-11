import { createClient, Client, Transaction, InValue } from '@libsql/client'
import { RunResult } from './base'
import { SqliteFamilyClient } from './sqlite-family'
import type { ConnectionConfig } from '../../shared/types'

/** LibSQL / Turso (remote libsql://, https://, or local file: URLs) */
export class LibsqlClient extends SqliteFamilyClient {
  protected readonly engine = 'libsql'
  private client?: Client
  private tx?: Transaction

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    if (!this.config.url) throw new Error('Enter a database URL, e.g. libsql://my-db.turso.io')
    this.client = createClient({ url: this.config.url, authToken: this.config.authToken || undefined })
    await this.client.execute('SELECT 1')
  }
  async disconnect() { this.client?.close() }


  protected async run(text: string, params: unknown[] = []): Promise<RunResult> {
    const exec = this.tx ?? this.client
    if (!exec) throw new Error('Not connected')
    const rs = await exec.execute({ sql: text, args: params as InValue[] })
    const rows = rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])))
    return { columns: rs.columns, rows, affected: rs.rowsAffected }
  }

  protected async transaction<T>(fn: () => Promise<T>) {
    if (!this.client) throw new Error('Not connected')
    this.tx = await this.client.transaction('write')
    try {
      const r = await fn()
      await this.tx.commit()
      return r
    } catch (e) {
      await this.tx.rollback()
      throw e
    } finally {
      this.tx.close()
      this.tx = undefined
    }
  }

  // Catalog queries live in SqliteFamilyClient
}
