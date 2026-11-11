import type { DynamoDBClient as Ddb } from '@aws-sdk/client-dynamodb'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { BaseClient, RunResult } from './base'
import { plain, splitStatements } from './split'
import type { ColumnInfo, ConnectionConfig, PageOptions, QueryResult, TableInfo } from '../../shared/types'

/**
 * Amazon DynamoDB through PartiQL (SELECT * FROM "Table" WHERE pk = 'x').
 * User = access key ID, password = secret access key; the URL field can point
 * at DynamoDB Local. Read-only in the grid; PartiQL INSERT / UPDATE / DELETE work in queries.
 */
export class DynamoDbClient extends BaseClient {
  readonly canEdit = false
  protected readonly engine = 'dynamodb'
  protected txSql = null
  private raw?: Ddb
  private doc?: DynamoDBDocumentClient
  private ddb = require('@aws-sdk/client-dynamodb') as typeof import('@aws-sdk/client-dynamodb') // eslint-disable-line @typescript-eslint/no-require-imports
  private lib = require('@aws-sdk/lib-dynamodb') as typeof import('@aws-sdk/lib-dynamodb') // eslint-disable-line @typescript-eslint/no-require-imports

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    const c = this.config
    this.raw = new this.ddb.DynamoDBClient({
      region: c.region || 'us-east-1',
      endpoint: c.url || undefined,
      // Empty keys use the normal AWS sign-in (environment, ~/.aws profile)
      credentials: c.user ? { accessKeyId: c.user, secretAccessKey: c.password ?? '', sessionToken: c.authToken || undefined } : undefined
    })
    this.doc = this.lib.DynamoDBDocumentClient.from(this.raw, { marshallOptions: { removeUndefinedValues: true } })
    await this.raw.send(new this.ddb.ListTablesCommand({ Limit: 1 }))
  }
  async disconnect() { this.raw?.destroy() }

  private get d() { if (!this.doc) throw new Error('Not connected'); return this.doc }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder() { return '?' }

  protected async run(sql: string, params: unknown[] = [], maxRows = 10000): Promise<RunResult> {
    const items: Record<string, unknown>[] = []
    let NextToken: string | undefined
    do {
      const r = await this.d.send(new this.lib.ExecuteStatementCommand({ Statement: sql, Parameters: params.length ? params : undefined, NextToken }))
      items.push(...(r.Items ?? []))
      NextToken = r.NextToken
    } while (NextToken && items.length < (maxRows || 10000))
    const isSelect = /^\s*select\b/i.test(sql)
    // Items can have different attributes: columns are all of them, keys first
    const cols = new Map<string, number>()
    for (const it of items) for (const k of Object.keys(it)) cols.set(k, (cols.get(k) ?? 0) + 1)
    const columns = [...cols.keys()]
    return { columns: isSelect ? columns : [], rows: items.map((it) => Object.fromEntries(columns.map((c) => [c, plain(it[c])]))), affected: isSelect ? 0 : 1, truncated: !!NextToken }
  }

  protected async runMulti(sql: string, maxRows = 0): Promise<RunResult[]> {
    const out: RunResult[] = []
    for (const s of splitStatements(sql)) out.push(await this.run(s, [], maxRows))
    return out
  }

  protected async transaction<T>(fn: () => Promise<T>) { return fn() }

  async listTables(): Promise<TableInfo[]> {
    const names: string[] = []
    let ExclusiveStartTableName: string | undefined
    do {
      const r = await this.raw!.send(new this.ddb.ListTablesCommand({ ExclusiveStartTableName }))
      names.push(...(r.TableNames ?? []))
      ExclusiveStartTableName = r.LastEvaluatedTableName
    } while (ExclusiveStartTableName)
    return names.map((name) => ({ name, type: 'table' as const }))
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const r = await this.raw!.send(new this.ddb.DescribeTableCommand({ TableName: t.name }))
    const types: Record<string, string> = { S: 'string', N: 'number', B: 'binary' }
    const keys = r.Table?.KeySchema ?? []
    const attr = new Map((r.Table?.AttributeDefinitions ?? []).map((a) => [a.AttributeName!, types[a.AttributeType!] ?? a.AttributeType!]))
    const cols: ColumnInfo[] = keys.map((k) => ({ name: k.AttributeName!, dataType: `${attr.get(k.AttributeName!)} (${k.KeyType === 'HASH' ? 'partition key' : 'sort key'})`, nullable: false, primaryKey: true }))
    // Other attributes are not declared; look at a few items to list them
    const sample = await this.d.send(new this.lib.ScanCommand({ TableName: t.name, Limit: 50 })).catch(() => null)
    const seen = new Set(cols.map((c) => c.name))
    for (const it of sample?.Items ?? []) for (const [k, v] of Object.entries(it)) {
      if (seen.has(k)) continue
      seen.add(k)
      cols.push({ name: k, dataType: Array.isArray(v) ? 'list' : v instanceof Set ? 'set' : v === null ? 'null' : typeof v === 'object' ? 'map' : typeof v, nullable: true, primaryKey: false })
    }
    return cols
  }

  /** PartiQL has no OFFSET: read pages until offset + limit. The total is DynamoDB's estimate. */
  async selectPage(t: TableInfo, o: PageOptions): Promise<QueryResult & { total: number | null }> {
    const start = performance.now()
    const cond = o.where?.trim()
    const want = Math.min(100000, o.offset + o.limit)
    const r = await this.run(`SELECT * FROM ${this.quoteIdent(t.name)}${cond ? ` WHERE ${cond}` : ''}`, [], want)
    let rows = r.rows
    if (o.orderBy?.length) {
      const { col, dir } = o.orderBy[0]
      rows = [...rows].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (dir === 'desc' ? -1 : 1))
    }
    rows = rows.slice(o.offset, o.offset + o.limit)
    const desc = cond ? null : await this.raw!.send(new this.ddb.DescribeTableCommand({ TableName: t.name })).catch(() => null)
    return { columns: r.columns, rows, rowCount: rows.length, durationMs: Math.round(performance.now() - start), total: desc?.Table?.ItemCount ?? null }
  }

  async selectTop(t: TableInfo, limit: number): Promise<QueryResult> {
    const r = await this.selectPage(t, { offset: 0, limit })
    return r
  }

  protected explainSql() { return null }
}
