import { createClient, ClickHouseClient as CH } from '@clickhouse/client'
import { BaseClient, DefinitionTarget, RunResult } from './base'
import type { ColumnInfo, ConnectionConfig, TableInfo, DbObject } from '../../shared/types'

/** ClickHouse over HTTP. Read-only in the grid: ClickHouse has no row-level UPDATE. */
export class ClickHouseClient extends BaseClient {
  readonly canEdit = false
  private client?: CH

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    const proto = this.config.ssl ? 'https' : 'http'
    this.client = createClient({
      url: `${proto}://${this.config.host || 'localhost'}:${this.config.port || 8123}`,
      username: this.config.user || 'default',
      password: this.config.password || '',
      database: this.config.database || 'default'
    })
    const ok = await this.client.ping()
    if (!ok.success) throw (ok as { error: Error }).error
  }
  async disconnect() { await this.client?.close() }

  private get c() {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }

  protected quoteIdent(name: string) { return `\`${name.replace(/`/g, '\\`')}\`` }
  protected placeholder(i: number) { return `{p${i}:String}` }

  protected async run(text: string): Promise<RunResult> {
    const stmt = text.trim().replace(/;+\s*$/, '')
    if (/^(select|with|show|describe|desc|explain|exists)\b/i.test(stmt)) {
      const rs = await this.c.query({ query: stmt, format: 'JSON' })
      const json = await rs.json<Record<string, unknown>>()
      return { columns: json.meta?.map((m) => m.name) ?? [], rows: json.data, affected: 0 }
    }
    await this.c.command({ query: stmt })
    return { columns: [], rows: [], affected: 0 }
  }

  protected async transaction<T>(fn: () => Promise<T>) { return fn() }

  async listDatabases() {
    const databases = await this.names(`SELECT name FROM system.databases ORDER BY name`)
    const [current] = await this.names(`SELECT currentDatabase()`)
    return { databases, current }
  }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.run(
      `SELECT database AS schema, name, if(engine LIKE '%View', 'view', 'table') AS type
         FROM system.tables WHERE database = currentDatabase() ORDER BY name`
    )
    return r.rows as unknown as TableInfo[]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const rs = await this.c.query({
      query: `SELECT name, type FROM system.columns
               WHERE database = coalesce({db:Nullable(String)}, currentDatabase()) AND table = {t:String}
               ORDER BY position`,
      query_params: { db: t.schema ?? null, t: t.name },
      format: 'JSONEachRow'
    })
    const rows = await rs.json<{ name: string; type: string }>()
    return rows.map((r) => ({ name: r.name, dataType: r.type, nullable: r.type.startsWith('Nullable'), primaryKey: false }))
  }

  protected readonly engine = 'clickhouse'
  protected txSql = null

  async listObjects(): Promise<DbObject[]> {
    const r = await this.run(`SELECT name FROM system.dictionaries WHERE database = currentDatabase() ORDER BY name`).catch(() => ({ rows: [] as any[] }))
    return r.rows.map((x: any) => ({ kind: 'function' as const, name: String(x.name) }))
  }

  async getDefinition(target: DefinitionTarget): Promise<string> {
    const what = target.kind === 'function' ? 'DICTIONARY' : 'TABLE'
    const r = await this.run(`SHOW CREATE ${what} ${this.quoteIdent(target.name)}`)
    const v = r.rows[0] && Object.values(r.rows[0])[0]
    if (!v) throw new Error('Definition not found')
    return String(v) + ';'
  }
}
