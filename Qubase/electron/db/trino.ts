import type { Trino } from 'trino-client'
import { BaseClient, RunResult } from './base'
import { plain, splitStatements } from './split'
import type { ColumnInfo, ConnectionConfig, PageOptions, TableInfo } from '../../shared/types'

/**
 * Trino / Presto. The "database" is the catalog; the schema field picks the default schema.
 * Read-only in the grid (most Trino connectors can't update rows).
 */
export class TrinoClient extends BaseClient {
  readonly canEdit = false
  protected readonly engine = 'trino'
  protected txSql = null
  private trino?: Trino
  private queryId?: string

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Trino, BasicAuth } = require('trino-client') as typeof import('trino-client')
    const c = this.config
    this.trino = Trino.create({
      server: `${c.ssl ? 'https' : 'http'}://${c.host || 'localhost'}:${c.port || 8080}`,
      catalog: c.database || undefined,
      schema: c.schema || undefined,
      source: 'Qubase',
      auth: new BasicAuth(c.user || 'qubase', c.password || undefined)
    })
    await this.run('SELECT 1')
  }
  async disconnect() { this.trino = undefined }

  private get t() { if (!this.trino) throw new Error('Not connected'); return this.trino }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder(): string { throw new Error('Trino does not support parameters here') }

  protected async run(sql: string, _params: unknown[] = [], maxRows = 50000): Promise<RunResult> {
    const iter = await this.t.query(sql.trim().replace(/;+\s*$/, ''))
    const rows: Record<string, unknown>[] = []
    let columns: string[] = []
    let affected = 0
    let truncated = false
    for await (const r of iter) {
      if (r.error) throw new Error(r.error.message)
      this.queryId = r.id
      if (r.columns) columns = r.columns.map((c) => c.name)
      if ((r as { updateCount?: number }).updateCount !== undefined) affected = Number((r as { updateCount?: number }).updateCount)
      for (const d of r.data ?? []) {
        if (rows.length >= (maxRows || 50000)) { truncated = true; break }
        rows.push(Object.fromEntries(columns.map((c, i) => [c, plain(d[i])])))
      }
      if (truncated) { await this.cancel().catch(() => {}); break }
    }
    this.queryId = undefined
    const isRows = /^\s*(select|with|show|describe|explain|values|table)\b/i.test(sql)
    return { columns: isRows ? columns : [], rows: isRows ? rows : [], affected, truncated }
  }

  protected async runMulti(sql: string, maxRows = 0): Promise<RunResult[]> {
    const out: RunResult[] = []
    for (const s of splitStatements(sql)) out.push(await this.run(s, [], maxRows))
    return out
  }

  async cancel() { if (this.queryId) await this.t.cancel(this.queryId) }
  protected async transaction<T>(fn: () => Promise<T>) { return fn() }

  /** Catalogs act as databases */
  async listDatabases() {
    return { databases: await this.names('SHOW CATALOGS'), current: this.config.database ?? '' }
  }

  async listTables(): Promise<TableInfo[]> {
    if (!this.config.database) return []
    const r = await this.run(`SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema <> 'information_schema' ORDER BY 1, 2`)
    return r.rows.map((x) => ({ schema: String(x.table_schema), name: String(x.table_name), type: x.table_type === 'VIEW' ? 'view' as const : 'table' as const }))
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const esc = (s: string) => s.replace(/'/g, "''")
    const r = await this.run(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = '${esc(t.schema ?? '')}' AND table_name = '${esc(t.name)}' ORDER BY ordinal_position`)
    return r.rows.map((c) => ({ name: String(c.column_name), dataType: String(c.data_type), nullable: c.is_nullable === 'YES', primaryKey: false }))
  }

  /** Trino writes OFFSET before LIMIT */
  protected pageSql(ref: string, where: string, order: string, o: PageOptions) {
    return `SELECT * FROM ${ref}${where}${order} OFFSET ${o.offset} LIMIT ${o.limit}`
  }
}
