import type { Client } from 'cassandra-driver'
import { BaseClient, RunResult } from './base'
import { plain, splitStatements } from './split'
import type { ColumnInfo, ConnectionConfig, PageOptions, QueryResult, TableInfo } from '../../shared/types'

/**
 * Apache Cassandra / ScyllaDB (CQL). The "database" is the keyspace.
 * Grid edits work by primary key; there are no multi-row transactions.
 */
export class CassandraClient extends BaseClient {
  protected readonly engine = 'cassandra'
  protected txSql = null
  private client?: Client

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cassandra = require('cassandra-driver') as typeof import('cassandra-driver')
    this.client = new cassandra.Client({
      contactPoints: (this.config.host || 'localhost').split(',').map((h) => h.trim()).filter(Boolean),
      localDataCenter: this.config.datacenter || 'datacenter1',
      keyspace: this.config.database || undefined,
      protocolOptions: { port: this.config.port || 9042 },
      credentials: this.config.user ? { username: this.config.user, password: this.config.password ?? '' } : undefined,
      sslOptions: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      socketOptions: { connectTimeout: 10000 }
    })
    await this.client.connect()
  }
  async disconnect() { await this.client?.shutdown() }

  private get c() { if (!this.client) throw new Error('Not connected'); return this.client }

  protected quoteIdent(name: string) { return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"` }
  protected placeholder() { return '?' }

  protected async run(sql: string, params: unknown[] = [], maxRows = 50000): Promise<RunResult> {
    const rows: Record<string, unknown>[] = []
    let columns: string[] = []
    let pageState: string | undefined
    // Read pages until the row limit
    do {
      const rs = await this.c.execute(sql, params as never[], { prepare: params.length > 0, fetchSize: 1000, pageState })
      columns = rs.columns?.map((c) => c.name) ?? columns
      for (const r of rs.rows ?? []) rows.push(Object.fromEntries(columns.map((c) => [c, plain(r[c])])))
      pageState = rs.pageState ?? undefined
    } while (pageState && rows.length < (maxRows || 50000))
    return { columns, rows, affected: 0, truncated: !!pageState }
  }

  protected async runMulti(sql: string, maxRows = 0): Promise<RunResult[]> {
    const out: RunResult[] = []
    for (const s of splitStatements(sql)) out.push(await this.run(s, [], maxRows))
    return out
  }

  protected async transaction<T>(fn: () => Promise<T>) { return fn() }

  async listDatabases() {
    const names = await this.names(`SELECT keyspace_name FROM system_schema.keyspaces`)
    return { databases: names.filter((n) => !n.startsWith('system')).sort(), current: this.c.keyspace ?? '' }
  }

  async listTables(): Promise<TableInfo[]> {
    const ks = this.c.keyspace
    const where = ks ? ' WHERE keyspace_name = ?' : ''
    const p = ks ? [ks] : []
    const [t, v] = await Promise.all([
      this.run(`SELECT keyspace_name, table_name FROM system_schema.tables${where}`, p),
      this.run(`SELECT keyspace_name, view_name FROM system_schema.views${where}`, p).catch(() => ({ rows: [] as Record<string, unknown>[] }))
    ])
    const keep = (k: unknown) => !String(k).startsWith('system')
    return [
      ...t.rows.filter((r) => keep(r.keyspace_name)).map((r) => ({ schema: String(r.keyspace_name), name: String(r.table_name), type: 'table' as const })),
      ...v.rows.filter((r) => keep(r.keyspace_name)).map((r) => ({ schema: String(r.keyspace_name), name: String(r.view_name), type: 'view' as const }))
    ].sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name))
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const r = await this.run(`SELECT column_name, type, kind, position FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?`, [t.schema ?? this.c.keyspace ?? '', t.name])
    const rank = (k: string) => (k === 'partition_key' ? 0 : k === 'clustering' ? 1 : 2)
    return r.rows
      .sort((a, b) => rank(String(a.kind)) - rank(String(b.kind)) || Number(a.position) - Number(b.position) || String(a.column_name).localeCompare(String(b.column_name)))
      .map((c) => ({ name: String(c.column_name), dataType: String(c.type), nullable: c.kind === 'regular', primaryKey: c.kind !== 'regular' && c.kind !== 'static' }))
  }

  /** CQL has no OFFSET or free ORDER BY: read up to offset + limit rows and skip the start. */
  async selectPage(t: TableInfo, o: PageOptions): Promise<QueryResult & { total: number | null }> {
    const cond = o.where?.trim()
    const where = cond ? ` WHERE ${cond}` : ''
    const allow = cond ? ' ALLOW FILTERING' : ''
    const start = performance.now()
    const want = Math.min(100000, o.offset + o.limit)
    const r = await this.run(`SELECT * FROM ${this.tableRef(t)}${where} LIMIT ${want}${allow}`, [], want)
    const rows = r.rows.slice(o.offset, o.offset + o.limit)
    const count = await this.run(`SELECT COUNT(*) AS n FROM ${this.tableRef(t)}${where}${allow}`).catch(() => null)
    const n = count?.rows[0] ? Number(Object.values(count.rows[0])[0]) : NaN
    return { columns: r.columns, rows, rowCount: rows.length, durationMs: Math.round(performance.now() - start), total: Number.isFinite(n) ? n : null }
  }

  protected explainSql() { return null }
}
