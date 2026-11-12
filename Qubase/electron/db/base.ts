import type { ColumnInfo, DbObject, ExplainResult, ForeignKeyInfo, IndexInfo, PageOptions, QueryResult, RowChange, RowUpdate, TableInfo, TableStructure, TxAction } from '../../shared/types'
import { createTableSql } from '../../shared/ddl'

export type DefinitionTarget = DbObject | (TableInfo & { kind: 'table' | 'view' })

export interface RunResult {
  columns: string[]
  rows: Record<string, unknown>[]
  affected: number
  /** Set when reading stopped early (row limit or Stop) */
  truncated?: boolean
}

/**
 * Every database adapter implements this one interface, so the UI never
 * needs to know which database it is talking to.
 */
export interface DbClient {
  readonly canEdit: boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  listTables(): Promise<TableInfo[]>
  listColumns(table: TableInfo): Promise<ColumnInfo[]>
  query(sql: string): Promise<QueryResult>
  /** Every result set of a multi-statement script; falls back to query() when absent */
  queryMulti?(sql: string, maxRows?: number): Promise<QueryResult[]>
  /** Stop the running query. Without it, the app reconnects to stop it. */
  cancel?(): Promise<void>
  selectTop(table: TableInfo, limit: number): Promise<QueryResult>
  applyUpdates(updates: RowUpdate[]): Promise<number>
  /** Inserts, updates and deletes in one transaction */
  applyChanges?(changes: RowChange[]): Promise<number>
  getStructure?(table: TableInfo): Promise<TableStructure>
  listObjects?(): Promise<DbObject[]>
  getDefinition?(target: DefinitionTarget): Promise<string>
  /** Databases on the server, for the sidebar picker. Absent when there is only one. */
  listDatabases?(): Promise<{ databases: string[]; current: string }>
  selectPage?(table: TableInfo, options: PageOptions): Promise<QueryResult & { total: number | null }>
  explain?(sql: string): Promise<ExplainResult>
  transactionControl?(action: TxAction): Promise<void>
}

export abstract class BaseClient implements DbClient {
  readonly canEdit: boolean = true

  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract listTables(): Promise<TableInfo[]>
  abstract listColumns(table: TableInfo): Promise<ColumnInfo[]>
  /** Run SQL with positional params. */
  protected abstract run(sql: string, params?: unknown[]): Promise<RunResult>
  /** Run several statements in one transaction. */
  protected abstract transaction<T>(fn: () => Promise<T>): Promise<T>
  protected abstract quoteIdent(name: string): string
  /** Placeholder for the 1-based parameter index, e.g. $1, ?, @p1, :1 */
  protected abstract placeholder(index: number): string

  /** Engine name, used to generate scripts (see shared/ddl.ts) */
  protected readonly engine: string = 'generic'

  /** Override to report indexes, foreign keys and triggers in the Structure tab. */
  protected async indexes(_t: TableInfo): Promise<IndexInfo[]> { return [] }
  protected async foreignKeys(_t: TableInfo): Promise<ForeignKeyInfo[]> { return [] }
  protected async tableTriggers(_t: TableInfo): Promise<DbObject[]> { return [] }

  async getStructure(t: TableInfo): Promise<TableStructure> {
    // Each part is optional: a failure (e.g. missing permission) leaves it empty.
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
    const [columns, indexes, foreignKeys, triggers] = await Promise.all([
      this.listColumns(t), safe(this.indexes(t)), safe(this.foreignKeys(t)), safe(this.tableTriggers(t))
    ])
    return { columns, indexes, foreignKeys, triggers }
  }

  /** CREATE TABLE built from the structure; adapters override for views and other objects. */
  async getDefinition(target: DefinitionTarget): Promise<string> {
    if (target.kind !== 'table') throw new Error(`Scripts for ${target.kind} are not available for this database`)
    return createTableSql(this.engine, target, await this.getStructure(target))
  }

  /** Helper: group rows of (name, column, …) into one entry per name, keeping order. */
  protected group<T extends { name: string }>(rows: Record<string, unknown>[], make: (r: Record<string, unknown>) => T, add: (item: T, r: Record<string, unknown>) => void): T[] {
    const m = new Map<string, T>()
    for (const r of rows) {
      const name = String(r.name)
      if (!m.has(name)) m.set(name, make(r))
      add(m.get(name)!, r)
    }
    return [...m.values()]
  }

  protected tableRef(t: TableInfo): string {
    return t.schema ? `${this.quoteIdent(t.schema)}.${this.quoteIdent(t.name)}` : this.quoteIdent(t.name)
  }

  /** Override for databases without LIMIT (SQL Server, Oracle). */
  protected selectTopSql(ref: string, n: number): string {
    return `SELECT * FROM ${ref} LIMIT ${n}`
  }

  /** Helper for listDatabases: the first column of each row, as strings. */
  protected async names(sql: string): Promise<string[]> {
    const r = await this.run(sql)
    return r.rows.map((row) => String(row[r.columns[0]]))
  }

  /** Override when the driver can return one result per statement. */
  protected async runMulti(sql: string, _maxRows = 0): Promise<RunResult[]> {
    return [await this.run(sql)]
  }

  /** Run a whole script and return every result set (SSMS-style "Result 1, Result 2…"). */
  async queryMulti(sql: string, maxRows = 0): Promise<QueryResult[]> {
    const start = performance.now()
    const all = await this.runMulti(sql, maxRows)
    const durationMs = Math.round(performance.now() - start)
    return all.map((r) => {
      // Drivers that can't stream still return everything; trim it so the UI stays fast.
      const cut = maxRows > 0 && r.rows.length > maxRows
      const rows = cut ? r.rows.slice(0, maxRows) : r.rows
      return {
        columns: r.columns,
        rows,
        rowCount: r.columns.length ? rows.length : r.affected,
        durationMs,
        truncated: cut || r.truncated
      }
    })
  }

  async query(sql: string): Promise<QueryResult> {
    const start = performance.now()
    const r = await this.run(sql)
    return {
      columns: r.columns,
      rows: r.rows,
      rowCount: r.columns.length ? r.rows.length : r.affected,
      durationMs: Math.round(performance.now() - start)
    }
  }

  async selectTop(table: TableInfo, limit: number): Promise<QueryResult> {
    const n = Math.max(1, Math.min(50000, Math.floor(limit)))
    return this.query(this.selectTopSql(this.tableRef(table), n))
  }

  async applyUpdates(updates: RowUpdate[]): Promise<number> {
    return this.applyChanges(updates.map((u) => ({ op: 'update' as const, ...u })))
  }

  // ---- Paging, filtering and sorting on the server ----

  /** Override for databases without LIMIT / OFFSET (SQL Server, Oracle). */
  protected pageSql(ref: string, where: string, order: string, o: PageOptions): string {
    return `SELECT * FROM ${ref}${where}${order} LIMIT ${o.limit} OFFSET ${o.offset}`
  }

  async selectPage(table: TableInfo, o: PageOptions): Promise<QueryResult & { total: number | null }> {
    const ref = this.tableRef(table)
    const cond = o.where?.trim()
    if (cond && /;/.test(cond.replace(/'(?:[^']|'')*'/g, ''))) throw new Error('The filter must be a single condition (no semicolons)')
    const where = cond ? ` WHERE ${cond}` : ''
    const order = o.orderBy?.length ? ` ORDER BY ${o.orderBy.map((s) => `${this.quoteIdent(s.col)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}` : ''
    const limit = Math.max(1, Math.min(100000, Math.floor(o.limit)))
    const start = performance.now()
    const [page, count] = await Promise.all([
      this.run(this.pageSql(ref, where, order, { ...o, limit, offset: Math.max(0, Math.floor(o.offset)) })),
      // A slow count must not block the rows, so it can fail quietly
      this.run(`SELECT COUNT(*) AS n FROM ${ref}${where}`).catch(() => null)
    ])
    const n = count?.rows[0] ? Number(Object.values(count.rows[0])[0]) : NaN
    return {
      columns: page.columns,
      rows: page.rows,
      rowCount: page.rows.length,
      durationMs: Math.round(performance.now() - start),
      total: Number.isFinite(n) ? n : null
    }
  }

  // ---- Query plans ----

  /** SQL that returns the plan; null when the database has none. */
  protected explainSql(sql: string): { sql: string; format: ExplainResult['format'] } | null {
    return { sql: `EXPLAIN ${sql}`, format: 'text' }
  }

  async explain(sql: string): Promise<ExplainResult> {
    const q = this.explainSql(sql.trim().replace(/;+\s*$/, ''))
    if (!q) throw new Error('Query plans are not available for this database')
    const r = await this.run(q.sql)
    // JSON plans come back as one cell; text plans as one line per row
    if (q.format !== 'text' && r.rows.length === 1 && r.columns.length === 1) {
      const v = r.rows[0][r.columns[0]]
      return { format: q.format, plan: typeof v === 'string' ? v : JSON.stringify(v) }
    }
    // DuckDB returns (explain_key, explain_value); only the value is the plan
    const cols = r.columns.includes('explain_value') ? ['explain_value'] : r.columns
    const lines = r.rows.map((row) => cols.map((c) => (row[c] === null || row[c] === undefined ? '' : String(row[c]))).join('  ').trimEnd())
    return { format: 'text', plan: lines.join('\n') }
  }

  // ---- Manual transactions (query tab buttons) ----

  protected txSql: Record<TxAction, string> | null = { begin: 'BEGIN', commit: 'COMMIT', rollback: 'ROLLBACK' }

  async transactionControl(action: TxAction): Promise<void> {
    if (!this.txSql) throw new Error('Transactions are not available for this database')
    await this.run(this.txSql[action])
  }

  /** SQL for inserting a row with only default values */
  protected insertDefaultsSql(ref: string) { return `INSERT INTO ${ref} DEFAULT VALUES` }

  async applyChanges(changes: RowChange[]): Promise<number> {
    if (!this.canEdit) throw new Error('Editing is not supported for this database')
    return this.transaction(async () => {
      let total = 0
      for (const ch of changes) {
        const params: unknown[] = []
        const ph = (val: unknown) => { params.push(val); return this.placeholder(params.length) }
        const pair = ([col, val]: [string, unknown]) =>
          val === null ? `${this.quoteIdent(col)} IS NULL` : `${this.quoteIdent(col)} = ${ph(val)}`
        const ref = this.tableRef(ch.table)
        let sql: string
        if (ch.op === 'insert') {
          const cols = Object.keys(ch.values)
          sql = cols.length
            ? `INSERT INTO ${ref} (${cols.map((c) => this.quoteIdent(c)).join(', ')}) VALUES (${cols.map((c) => ph(ch.values[c])).join(', ')})`
            : this.insertDefaultsSql(ref)
        } else {
          const where = Object.entries(ch.primaryKey).map(pair)
          if (!where.length) throw new Error('Rows can only be changed in tables with a primary key')
          if (ch.op === 'delete') sql = `DELETE FROM ${ref} WHERE ${where.join(' AND ')}`
          else {
            // SET must use placeholders before WHERE, so build it first with a fresh list
            params.length = 0
            const set = Object.entries(ch.changes).map(([c, v]) => `${this.quoteIdent(c)} = ${ph(v)}`)
            if (!set.length) continue
            const w = Object.entries(ch.primaryKey).map(pair)
            sql = `UPDATE ${ref} SET ${set.join(', ')} WHERE ${w.join(' AND ')}`
          }
        }
        total += (await this.run(sql, params)).affected
      }
      return total
    })
  }
}
