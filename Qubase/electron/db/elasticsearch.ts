import { BaseClient, RunResult } from './base'
import { plain, splitStatements } from './split'
import type { ColumnInfo, ConnectionConfig, PageOptions, TableInfo } from '../../shared/types'

/**
 * Elasticsearch and OpenSearch through their SQL endpoints (no extra driver):
 * Elasticsearch: POST /_sql?format=json · OpenSearch: POST /_plugins/_sql (format jdbc).
 * Indices show up as tables. Read-only in the grid.
 */
export class ElasticClient extends BaseClient {
  readonly canEdit = false
  protected readonly engine = 'elasticsearch'
  protected txSql = null
  private abort?: AbortController

  constructor(private config: ConnectionConfig, private flavour: 'elastic' | 'opensearch') { super() }

  private get base() {
    const c = this.config
    return (c.url?.trim() || `${c.ssl ? 'https' : 'http'}://${c.host || 'localhost'}:${c.port || 9200}`).replace(/\/+$/, '')
  }

  private async call(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
    const c = this.config
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (c.authToken) headers.Authorization = `ApiKey ${c.authToken}`
    else if (c.user) headers.Authorization = 'Basic ' + Buffer.from(`${c.user}:${c.password ?? ''}`).toString('base64')
    this.abort = new AbortController()
    const res = await fetch(this.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: this.abort.signal })
    const text = await res.text()
    let json: any // eslint-disable-line @typescript-eslint/no-explicit-any
    try { json = text ? JSON.parse(text) : {} } catch { json = { error: text } }
    if (!res.ok || json?.error) {
      const e = json?.error
      throw new Error(typeof e === 'string' ? e : e?.reason ?? e?.root_cause?.[0]?.reason ?? e?.details ?? `The server answered ${res.status}`)
    }
    return json
  }

  async connect() {
    const info = await this.call('/')
    if (!info?.version) throw new Error(`No ${this.flavour === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'} server answered at ${this.base}`)
  }
  async disconnect() { this.abort?.abort() }
  async cancel() { this.abort?.abort() }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder(): string { throw new Error('Parameters are not supported here') }
  protected async transaction<T>(fn: () => Promise<T>) { return fn() }

  protected async run(sql: string, _params: unknown[] = [], maxRows = 10000): Promise<RunResult> {
    // pageSql marks how many leading rows to drop, since there is no OFFSET
    const skipMark = /^\/\*skip:(\d+)\*\/\s*/.exec(sql)
    const skip = skipMark ? Number(skipMark[1]) : 0
    const query = sql.slice(skipMark?.[0].length ?? 0).trim().replace(/;+\s*$/, '')
    const limit = (maxRows || 10000) + skip
    const done = (r: RunResult): RunResult => (skip ? { ...r, rows: r.rows.slice(skip) } : r)
    const columns: string[] = []
    const rows: Record<string, unknown>[] = []
    const add = (vals: unknown[][]) => {
      for (const v of vals) { if (rows.length >= limit) break; rows.push(Object.fromEntries(columns.map((c, i) => [c, plain(v[i])]))) }
    }
    if (this.flavour === 'opensearch') {
      const r = await this.call('/_plugins/_sql', { query, fetch_size: Math.min(limit, 10000) })
      for (const s of r.schema ?? []) columns.push(String(s.alias ?? s.name))
      add(r.datarows ?? [])
      let cursor = r.cursor
      while (cursor && rows.length < limit) { const n = await this.call('/_plugins/_sql', { cursor }); add(n.datarows ?? []); cursor = n.cursor }
      return done({ columns, rows, affected: 0, truncated: rows.length >= limit && !!cursor })
    }
    const r = await this.call('/_sql?format=json', { query, fetch_size: Math.min(limit, 1000) })
    for (const c of r.columns ?? []) columns.push(String(c.name))
    add(r.rows ?? [])
    let cursor = r.cursor
    while (cursor && rows.length < limit) { const n = await this.call('/_sql?format=json', { cursor }); add(n.rows ?? []); cursor = n.cursor }
    if (cursor) await this.call('/_sql/close', { cursor }).catch(() => {})
    return done({ columns, rows, affected: 0, truncated: rows.length >= limit && !!cursor })
  }

  protected async runMulti(sql: string, maxRows = 0): Promise<RunResult[]> {
    const out: RunResult[] = []
    for (const s of splitStatements(sql)) out.push(await this.run(s, [], maxRows))
    return out
  }

  async listTables(): Promise<TableInfo[]> {
    const r: { index: string; status?: string }[] = await this.call('/_cat/indices?format=json&h=index,status')
    const aliases: { alias: string }[] = await this.call('/_cat/aliases?format=json&h=alias').catch(() => [])
    const names = r.map((x) => x.index).filter((n) => !n.startsWith('.')).sort()
    return [
      ...names.map((name) => ({ name, type: 'table' as const })),
      ...[...new Set(aliases.map((a) => a.alias).filter((n) => !n.startsWith('.')))].sort().map((name) => ({ name, type: 'view' as const }))
    ]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const m = await this.call(`/${encodeURIComponent(t.name)}/_mapping`)
    const out: ColumnInfo[] = []
    const walk = (props: Record<string, any> | undefined, prefix: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const [k, v] of Object.entries(props ?? {})) {
        if (v.properties) walk(v.properties, `${prefix}${k}.`)
        else out.push({ name: prefix + k, dataType: String(v.type ?? 'object'), nullable: true, primaryKey: false })
      }
    }
    for (const idx of Object.values(m) as { mappings?: { properties?: Record<string, unknown> } }[]) { walk(idx.mappings?.properties as Record<string, never>, ''); break }
    return out
  }

  /** Elasticsearch SQL has LIMIT but no OFFSET: page by fetching up to the end of the page */
  protected pageSql(ref: string, where: string, order: string, o: PageOptions) {
    return `/*skip:${o.offset}*/ SELECT * FROM ${ref}${where}${order} LIMIT ${o.offset + o.limit}`
  }
}
