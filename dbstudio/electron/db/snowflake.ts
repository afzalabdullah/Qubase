import type { Connection, RowStatement } from 'snowflake-sdk'
import { BaseClient, RunResult } from './base'
import { plain, splitStatements } from './split'
import type { ColumnInfo, ConnectionConfig, TableInfo } from '../../shared/types'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snowflake: typeof import('snowflake-sdk') = require('snowflake-sdk')
snowflake.configure({ logLevel: 'ERROR' })

/** Snowflake. The host field holds the account identifier (e.g. xy12345.eu-west-1). */
export class SnowflakeClient extends BaseClient {
  private conn?: Connection
  private current?: RowStatement
  protected readonly engine = 'snowflake'

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    const account = (this.config.host ?? '').replace(/^https?:\/\//, '').replace(/\.snowflakecomputing\.com\/?$/i, '')
    if (!account) throw new Error('Enter the Snowflake account identifier')
    this.conn = snowflake.createConnection({
      account,
      username: this.config.user,
      password: this.config.password,
      database: this.config.database || undefined,
      schema: this.config.schema || undefined,
      warehouse: this.config.warehouse || undefined,
      role: this.config.role || undefined,
      application: 'Qubase'
    })
    await new Promise<void>((ok, fail) => this.conn!.connect((err) => (err ? fail(err) : ok())))
  }

  async disconnect() {
    const c = this.conn
    this.conn = undefined
    if (c) await new Promise<void>((ok) => c.destroy(() => ok()))
  }

  private get c() { if (!this.conn) throw new Error('Not connected'); return this.conn }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder() { return '?' }

  protected run(sql: string, params: unknown[] = []): Promise<RunResult> {
    return new Promise((ok, fail) => {
      this.current = this.c.execute({
        sqlText: sql,
        binds: params as never,
        complete: (err, stmt, rows) => {
          this.current = undefined
          if (err) return fail(err)
          const columns = stmt.getColumns()?.map((c) => c.getName()) ?? []
          const data = (rows ?? []).map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])))
          ok({ columns, rows: data, affected: stmt.getNumUpdatedRows() ?? 0 })
        }
      })
    })
  }

  protected async runMulti(sql: string): Promise<RunResult[]> {
    const out: RunResult[] = []
    for (const s of splitStatements(sql)) out.push(await this.run(s))
    return out
  }

  async cancel() {
    const s = this.current
    if (s) await new Promise<void>((ok) => s.cancel(() => ok()))
  }

  protected async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.run('BEGIN')
    try { const r = await fn(); await this.run('COMMIT'); return r } catch (e) { await this.run('ROLLBACK').catch(() => {}); throw e }
  }

  async listDatabases() {
    const r = await this.run('SHOW DATABASES')
    const [cur] = await this.names('SELECT CURRENT_DATABASE()')
    return { databases: r.rows.map((x) => String(x.name)), current: cur === 'null' ? '' : cur }
  }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.run(`SELECT table_schema AS "schema", table_name AS "name", CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS "type"
      FROM information_schema.tables WHERE table_schema <> 'INFORMATION_SCHEMA' ORDER BY 1, 2`)
    return r.rows as unknown as TableInfo[]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const r = await this.run(`SELECT column_name AS "name", data_type AS "type", is_nullable AS "nullable", column_default AS "def"
      FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`, [t.schema ?? '', t.name])
    const pk = await this.run(`SHOW PRIMARY KEYS IN TABLE ${this.tableRef(t)}`).then((x) => new Set(x.rows.map((k) => String(k.column_name)))).catch(() => new Set<string>())
    return r.rows.map((c) => ({ name: String(c.name), dataType: String(c.type), nullable: c.nullable === 'YES', primaryKey: pk.has(String(c.name)), defaultValue: c.def as string | null }))
  }

  protected explainSql(sql: string) { return { sql: `EXPLAIN USING TEXT ${sql}`, format: 'text' as const } }
}
