import sql from 'mssql'
import { BaseClient, DefinitionTarget, RunResult } from './base'
import type { ColumnInfo, ConnectionConfig, DbObject, ForeignKeyInfo, IndexInfo, ObjectKind, TableInfo } from '../../shared/types'
import { createTableSql } from '../../shared/ddl'

/** SQL Server and Azure SQL */
export class MssqlClient extends BaseClient {
  protected readonly engine = 'mssql'
  private pool?: sql.ConnectionPool
  private tx?: sql.Transaction

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    this.pool = new sql.ConnectionPool({
      server: this.config.host || 'localhost',
      port: this.config.port || 1433,
      ...(this.config.authType === 'ntlm'
        ? { authentication: { type: 'ntlm', options: { domain: this.config.domain ?? '', userName: this.config.user ?? '', password: this.config.password ?? '' } } }
        : { user: this.config.user, password: this.config.password }),
      database: this.config.database || undefined,
      options: {
        encrypt: !!this.config.ssl,
        trustServerCertificate: this.config.trustServerCertificate ?? true
      },
      // Query tabs use exactly one connection so transactions (BEGIN … COMMIT) work
      pool: this.config.session ? { min: 1, max: 1 } : { max: 4 }
    })
    this.pool.on('error', () => {})
    await this.pool.connect()
  }
  async disconnect() { await this.pool?.close() }

  private request() {
    if (this.tx) return new sql.Request(this.tx)
    if (!this.pool) throw new Error('Not connected')
    return new sql.Request(this.pool)
  }

  protected quoteIdent(name: string) { return `[${name.replace(/]/g, ']]')}]` }
  protected placeholder(i: number) { return `@p${i}` }
  protected selectTopSql(ref: string, n: number) { return `SELECT TOP (${n}) * FROM ${ref}` }
  protected pageSql(ref: string, where: string, order: string, o: { offset: number; limit: number }) {
    return `SELECT * FROM ${ref}${where}${order || ' ORDER BY (SELECT NULL)'} OFFSET ${o.offset} ROWS FETCH NEXT ${o.limit} ROWS ONLY`
  }
  protected txSql = { begin: 'BEGIN TRANSACTION', commit: 'COMMIT TRANSACTION', rollback: 'ROLLBACK TRANSACTION' }

  /** SHOWPLAN_XML must be the only statement in its batch, so it takes three round trips on one connection. */
  async explain(text: string) {
    if (!this.config.session) throw new Error('Open the plan from a query tab')
    await this.run('SET SHOWPLAN_XML ON')
    try {
      const r = await this.run(text)
      const v = r.rows[0]?.[r.columns[0]]
      return { format: 'xml' as const, plan: String(v ?? '') }
    } finally {
      await this.run('SET SHOWPLAN_XML OFF').catch(() => {})
    }
  }

  protected async run(text: string, params: unknown[] = []): Promise<RunResult> {
    const req = this.request()
    params.forEach((v, i) => req.input(`p${i + 1}`, v))
    const res = await req.query(text)
    // A batch can return several result sets; show the last one with columns.
    const sets = (res.recordsets as unknown as sql.IRecordSet<Record<string, unknown>>[]) ?? []
    const last = sets[sets.length - 1]
    const affected = (res.rowsAffected ?? []).reduce((a, b) => a + b, 0)
    if (!last) return { columns: [], rows: [], affected }
    return { columns: Object.keys(last.columns ?? {}), rows: [...last], affected }
  }

  private current?: sql.Request

  async cancel() { this.current?.cancel() }

  /**
   * A batch returns every result set, shown as Result 1, Result 2… like SSMS.
   * Rows are streamed, so we can stop reading once maxRows is reached instead of
   * pulling millions of rows into memory.
   */
  /** Split on GO lines (like SSMS) and run each batch in order. */
  protected async runMulti(text: string, maxRows = 0): Promise<RunResult[]> {
    const batches = text.split(/^\s*GO\s*(?:--.*)?$/gim).filter((b) => b.trim())
    if (batches.length <= 1) return this.runBatch(batches[0] ?? text, maxRows)
    const all: RunResult[] = []
    let from = 0
    for (const b of batches) {
      // Line of the batch's first character, so error lines point into the whole script
      const at = text.indexOf(b, from)
      const offset = at >= 0 ? text.slice(0, at).split('\n').length - 1 : 0
      from = at >= 0 ? at + b.length : from
      try {
        const r = await this.runBatch(b, maxRows)
        all.push(...r)
        if (r.some((x) => x.truncated)) break // stopped by Stop or row limit
      } catch (e) {
        const err = e as { lineNumber?: number }
        if (typeof err.lineNumber === 'number') err.lineNumber += offset
        throw e
      }
    }
    return all
  }

  private runBatch(text: string, maxRows = 0): Promise<RunResult[]> {
    const req = this.request()
    req.stream = true
    this.current = req
    return new Promise((resolve, reject) => {
      const sets: RunResult[] = []
      let affected = 0
      let stopped = false
      let settled = false
      const finish = (err?: unknown) => {
        if (settled) return
        settled = true
        if (this.current === req) this.current = undefined
        // A Stop with nothing read yet is an error; otherwise keep what arrived.
        if (err && !(stopped && sets.length)) return reject(stopped ? new Error('Query cancelled') : err)
        if (stopped) for (const s of sets) s.truncated = true
        resolve(sets.length ? sets : [{ columns: [], rows: [], affected }])
      }
      req.on('recordset', (cols: Record<string, unknown>) => sets.push({ columns: Object.keys(cols ?? {}), rows: [], affected: 0 }))
      req.on('row', (row: Record<string, unknown>) => {
        const s = sets[sets.length - 1]
        if (!s || stopped) return
        if (maxRows > 0 && s.rows.length >= maxRows) {
          stopped = true
          req.cancel()
          return
        }
        s.rows.push(row)
      })
      req.on('rowsaffected', (n: number) => { affected += n })
      req.on('error', (e: unknown) => {
        const code = (e as { code?: string })?.code
        if (code === 'ECANCEL') { stopped = true; finish(stopped && sets.length ? undefined : e) } else finish(e)
      })
      req.on('done', () => finish())
      req.query(text)
    })
  }

  protected async transaction<T>(fn: () => Promise<T>) {
    if (!this.pool) throw new Error('Not connected')
    const tx = new sql.Transaction(this.pool)
    await tx.begin()
    this.tx = tx
    try {
      const r = await fn()
      await tx.commit()
      return r
    } catch (e) {
      await tx.rollback()
      throw e
    } finally {
      this.tx = undefined
    }
  }

  async listDatabases() {
    const databases = await this.names(`SELECT name FROM sys.databases WHERE HAS_DBACCESS(name) = 1 AND state = 0 ORDER BY name`)
    const [current] = await this.names(`SELECT DB_NAME()`)
    return { databases, current }
  }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.run(
      `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name,
              CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS type
         FROM INFORMATION_SCHEMA.TABLES
        ORDER BY TABLE_SCHEMA, TABLE_NAME`
    )
    return r.rows as unknown as TableInfo[]
  }

  private objName(t: { schema?: string; name: string }) {
    return `${this.quoteIdent(t.schema || 'dbo')}.${this.quoteIdent(t.name)}`
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const r = await this.run(
      `SELECT c.name,
              ty.name + CASE
                WHEN ty.name IN ('varchar','char','varbinary','binary') THEN '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length AS varchar)) + ')'
                WHEN ty.name IN ('nvarchar','nchar') THEN '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length / 2 AS varchar)) + ')'
                WHEN ty.name IN ('decimal','numeric') THEN '(' + CAST(c.precision AS varchar) + ',' + CAST(c.scale AS varchar) + ')'
                WHEN ty.name IN ('datetime2','time','datetimeoffset') THEN '(' + CAST(c.scale AS varchar) + ')'
                ELSE '' END AS dataType,
              c.is_nullable AS nullable, c.is_identity AS autoIncrement,
              OBJECT_DEFINITION(c.default_object_id) AS defaultValue,
              CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                                WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS primaryKey
         FROM sys.columns c JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID(@p1)
        ORDER BY c.column_id`,
      [this.objName(t)]
    )
    return r.rows.map((x: any) => ({
      name: x.name, dataType: x.dataType, nullable: !!x.nullable, primaryKey: !!x.primaryKey,
      autoIncrement: !!x.autoIncrement, defaultValue: x.defaultValue ?? null
    }))
  }

  protected async indexes(t: TableInfo): Promise<IndexInfo[]> {
    const r = await this.run(
      `SELECT i.name, i.is_unique AS uniq, i.is_primary_key AS prim, c.name AS col
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE i.object_id = OBJECT_ID(@p1) AND i.name IS NOT NULL
        ORDER BY i.name, ic.key_ordinal`, [this.objName(t)])
    return this.group(r.rows, (x) => ({ name: String(x.name), unique: !!x.uniq, primary: !!x.prim, columns: [] as string[] }), (ix, x) => ix.columns.push(String(x.col)))
  }

  protected async foreignKeys(t: TableInfo): Promise<ForeignKeyInfo[]> {
    const r = await this.run(
      `SELECT fk.name, pc.name AS col, OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS rs,
              OBJECT_NAME(fk.referenced_object_id) AS rt, rc.name AS rcol
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns k ON k.constraint_object_id = fk.object_id
         JOIN sys.columns pc ON pc.object_id = k.parent_object_id AND pc.column_id = k.parent_column_id
         JOIN sys.columns rc ON rc.object_id = k.referenced_object_id AND rc.column_id = k.referenced_column_id
        WHERE fk.parent_object_id = OBJECT_ID(@p1)
        ORDER BY fk.name, k.constraint_column_id`, [this.objName(t)])
    return this.group(r.rows, (x) => ({ name: String(x.name), refSchema: String(x.rs), refTable: String(x.rt), columns: [] as string[], refColumns: [] as string[] }),
      (fk, x) => { fk.columns.push(String(x.col)); fk.refColumns.push(String(x.rcol)) })
  }

  protected async tableTriggers(t: TableInfo): Promise<DbObject[]> {
    const r = await this.run(`SELECT name FROM sys.triggers WHERE parent_id = OBJECT_ID(@p1) ORDER BY name`, [this.objName(t)])
    return r.rows.map((x: any) => ({ kind: 'trigger' as const, schema: t.schema, name: x.name, table: t.name }))
  }

  async listObjects(): Promise<DbObject[]> {
    const kinds: Record<string, ObjectKind> = { P: 'procedure', PC: 'procedure', FN: 'function', IF: 'function', TF: 'function', FS: 'function', FT: 'function', TR: 'trigger', SO: 'sequence', SN: 'synonym' }
    const r = await this.run(
      `SELECT SCHEMA_NAME(o.schema_id) AS [schema], o.name, RTRIM(o.type) AS type, OBJECT_NAME(o.parent_object_id) AS tbl
         FROM sys.objects o
        WHERE o.type IN ('P','PC','FN','IF','TF','FS','FT','TR','SO','SN') AND o.is_ms_shipped = 0
        ORDER BY o.name`)
    return r.rows.map((x: any) => ({ kind: kinds[x.type], schema: x.schema, name: x.name, table: x.tbl ?? undefined }))
  }

  async getDefinition(target: DefinitionTarget): Promise<string> {
    const ref = this.objName(target)
    if (target.kind === 'table') return createTableSql(this.engine, target, await this.getStructure(target))
    if (target.kind === 'sequence') {
      const r = await this.run(
        `SELECT TYPE_NAME(user_type_id) AS t, start_value AS s, increment AS i, minimum_value AS mn, maximum_value AS mx, is_cycling AS c
           FROM sys.sequences WHERE object_id = OBJECT_ID(@p1)`, [ref])
      const x: any = r.rows[0]
      if (!x) throw new Error('Sequence not found')
      return `CREATE SEQUENCE ${ref} AS ${x.t}\n  START WITH ${x.s}\n  INCREMENT BY ${x.i}\n  MINVALUE ${x.mn}\n  MAXVALUE ${x.mx}\n  ${x.c ? 'CYCLE' : 'NO CYCLE'};`
    }
    if (target.kind === 'synonym') {
      const r = await this.run(`SELECT base_object_name AS b FROM sys.synonyms WHERE object_id = OBJECT_ID(@p1)`, [ref])
      return `CREATE SYNONYM ${ref} FOR ${(r.rows[0] as any)?.b};`
    }
    // Views, procedures, functions, triggers: stored source, opened as CREATE OR ALTER (like SSMS "Modify")
    const r = await this.run(`SELECT OBJECT_DEFINITION(OBJECT_ID(@p1)) AS d`, [ref])
    const def = (r.rows[0] as any)?.d as string | null
    if (!def) throw new Error('No definition found (it may be encrypted, or you lack VIEW DEFINITION permission)')
    return def.replace(/^((?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*)CREATE\s+(?!OR\s)/i, '$1CREATE OR ALTER ')
  }
}
