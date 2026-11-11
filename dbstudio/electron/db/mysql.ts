import mysql from 'mysql2/promise'
import { BaseClient, DefinitionTarget } from './base'
import { sslOptions } from './ssl'
import type { ColumnInfo, ConnectionConfig, DbObject, ForeignKeyInfo, IndexInfo, TableInfo } from '../../shared/types'

export class MysqlClient extends BaseClient {
  protected readonly engine = 'mysql'
  private conn?: mysql.Connection

  constructor(private config: ConnectionConfig) { super() }

  private options(): mysql.ConnectionOptions {
    return {
      host: this.config.host || 'localhost',
      port: this.config.port || 3306,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: true,
      ssl: sslOptions(this.config)
    }
  }

  async connect() {
    this.conn = await mysql.createConnection(this.options())
  }
  async disconnect() { await this.conn?.end() }

  private get c() {
    if (!this.conn) throw new Error('Not connected')
    return this.conn
  }

  protected quoteIdent(name: string) { return `\`${name.replace(/`/g, '``')}\`` }
  protected placeholder() { return '?' }
  protected explainSql(text: string) { return { sql: `EXPLAIN FORMAT=JSON ${text}`, format: 'json' as const } }
  protected txSql = { begin: 'START TRANSACTION', commit: 'COMMIT', rollback: 'ROLLBACK' }

  /** Stop the running query from a second connection (KILL QUERY keeps this connection open). */
  async cancel() {
    const id = this.c.threadId
    const killer = await mysql.createConnection({ ...this.options(), multipleStatements: false })
    try { await killer.query(`KILL QUERY ${Number(id)}`) } finally { await killer.end().catch(() => {}) }
  }

  protected async run(sql: string, params?: unknown[]) {
    const [result, fields] = await this.c.query(sql, params)
    if (Array.isArray(result)) {
      return {
        columns: (fields ?? []).map((f) => f.name),
        rows: result as Record<string, unknown>[],
        affected: 0
      }
    }
    return { columns: [], rows: [], affected: (result as mysql.ResultSetHeader).affectedRows }
  }

  /** With several statements, mysql2 returns one result (and field list) per statement. */
  protected async runMulti(sql: string, maxRows = 0) {
    if (maxRows > 0 && isSingleSelect(sql)) return [await this.streamSelect(sql, maxRows)]
    const [result, fields] = (await this.c.query(sql)) as unknown as [unknown[], unknown[]]
    const isMulti = Array.isArray(fields) && fields.some((f) => f === undefined || Array.isArray(f))
    if (!isMulti) return [await this.toRun(result, fields as mysql.FieldPacket[])]
    return result.map((r, i) => this.toRun(r, fields[i] as mysql.FieldPacket[] | undefined))
  }

  /** Read rows one by one and stop the query at the row limit, so a huge table doesn't fill memory. */
  private streamSelect(sql: string, maxRows: number) {
    type Core = { query(sql: string): NodeJS.EventEmitter }
    const core = (this.c as unknown as { connection: Core }).connection
    return new Promise<{ columns: string[]; rows: Record<string, unknown>[]; affected: number; truncated?: boolean }>((resolve, reject) => {
      const rows: Record<string, unknown>[] = []
      let columns: string[] = []
      let stopped = false
      const q = core.query(sql.trim().replace(/;+\s*$/, ''))
      q.on('fields', (f: { name: string }[]) => { if (!columns.length) columns = (f ?? []).map((x) => x.name) })
      q.on('result', (row: Record<string, unknown>) => {
        if (stopped) return
        if (rows.length >= maxRows) {
          stopped = true
          this.cancel().catch(() => {})
          return
        }
        rows.push(row)
      })
      q.on('error', (e: Error) => { if (stopped) resolve({ columns, rows, affected: 0, truncated: true }); else reject(e) })
      q.on('end', () => resolve({ columns, rows, affected: 0, truncated: stopped }))
    })
  }

  private toRun(r: unknown, f?: mysql.FieldPacket[]) {
    if (Array.isArray(r)) return { columns: (f ?? []).map((x) => x.name), rows: r as Record<string, unknown>[], affected: 0 }
    return { columns: [], rows: [], affected: (r as mysql.ResultSetHeader).affectedRows ?? 0 }
  }

  protected insertDefaultsSql(ref: string) { return `INSERT INTO ${ref} () VALUES ()` }

  protected async transaction<T>(fn: () => Promise<T>) {
    await this.c.beginTransaction()
    try {
      const r = await fn()
      await this.c.commit()
      return r
    } catch (e) {
      await this.c.rollback()
      throw e
    }
  }

  async listDatabases() {
    const databases = await this.names(`SHOW DATABASES`)
    const [current] = await this.names(`SELECT IFNULL(DATABASE(), '')`)
    return { databases, current }
  }

  async listTables(): Promise<TableInfo[]> {
    const [rows] = await this.c.query(
      `SELECT table_schema AS \`schema\`, table_name AS name,
              IF(table_type = 'VIEW', 'view', 'table') AS type
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY table_name`
    )
    return rows as TableInfo[]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const [rows] = await this.c.query(
      `SELECT column_name AS name, column_type AS dataType, column_default AS defaultValue,
              is_nullable = 'YES' AS nullable, column_key = 'PRI' AS primaryKey,
              extra LIKE '%auto_increment%' AS autoIncrement
         FROM information_schema.columns
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
        ORDER BY ordinal_position`,
      [t.schema ?? null, t.name]
    )
    return (rows as any[]).map((r) => ({
      ...r, nullable: !!r.nullable, primaryKey: !!r.primaryKey, autoIncrement: !!r.autoIncrement,
      // MySQL reports text defaults without quotes; add them back so the value can be reused in SQL
      defaultValue: r.defaultValue === null ? null
        : /^(-?\d+(\.\d+)?|CURRENT_TIMESTAMP(\(\d*\))?|NULL|\(.*\))$/i.test(r.defaultValue) ? r.defaultValue
        : `'${String(r.defaultValue).replace(/'/g, "''")}'`
    }))
  }

  protected async indexes(t: TableInfo): Promise<IndexInfo[]> {
    const [rows] = await this.c.query(
      `SELECT index_name AS name, non_unique = 0 AS uniq, column_name AS col
         FROM information_schema.statistics
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
        ORDER BY index_name, seq_in_index`, [t.schema ?? null, t.name])
    return this.group(rows as Record<string, unknown>[],
      (x) => ({ name: String(x.name), unique: !!x.uniq, primary: x.name === 'PRIMARY', columns: [] as string[] }),
      (ix, x) => ix.columns.push(String(x.col)))
  }

  protected async foreignKeys(t: TableInfo): Promise<ForeignKeyInfo[]> {
    const [rows] = await this.c.query(
      `SELECT constraint_name AS name, column_name AS col, referenced_table_schema AS rs,
              referenced_table_name AS rt, referenced_column_name AS rcol
         FROM information_schema.key_column_usage
        WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ? AND referenced_table_name IS NOT NULL
        ORDER BY constraint_name, ordinal_position`, [t.schema ?? null, t.name])
    return this.group(rows as Record<string, unknown>[],
      (x) => ({ name: String(x.name), refSchema: String(x.rs), refTable: String(x.rt), columns: [] as string[], refColumns: [] as string[] }),
      (fk, x) => { fk.columns.push(String(x.col)); fk.refColumns.push(String(x.rcol)) })
  }

  protected async tableTriggers(t: TableInfo): Promise<DbObject[]> {
    const [rows] = await this.c.query(
      `SELECT trigger_schema AS \`schema\`, trigger_name AS name FROM information_schema.triggers
        WHERE event_object_schema = COALESCE(?, DATABASE()) AND event_object_table = ? ORDER BY 2`, [t.schema ?? null, t.name])
    return (rows as any[]).map((x) => ({ kind: 'trigger' as const, schema: x.schema, name: x.name, table: t.name }))
  }

  async listObjects(): Promise<DbObject[]> {
    const [rows] = await this.c.query(
      `SELECT LOWER(routine_type) AS kind, routine_schema AS \`schema\`, routine_name AS name, NULL AS tbl
         FROM information_schema.routines WHERE routine_schema = DATABASE()
       UNION ALL
       SELECT 'trigger', trigger_schema, trigger_name, event_object_table
         FROM information_schema.triggers WHERE trigger_schema = DATABASE()
       UNION ALL
       SELECT 'event', event_schema, event_name, NULL
         FROM information_schema.events WHERE event_schema = DATABASE()
       ORDER BY 3`)
    return (rows as any[]).map((x) => ({ kind: x.kind, schema: x.schema, name: x.name, table: x.tbl ?? undefined }))
  }

  /** SHOW CREATE … for every object type MySQL knows */
  async getDefinition(target: DefinitionTarget): Promise<string> {
    const what = ({ table: 'TABLE', view: 'VIEW', procedure: 'PROCEDURE', function: 'FUNCTION', trigger: 'TRIGGER', event: 'EVENT' } as Record<string, string>)[target.kind]
    if (!what) throw new Error(`Scripts for ${target.kind} are not available`)
    const ref = target.schema ? `${this.quoteIdent(target.schema)}.${this.quoteIdent(target.name)}` : this.quoteIdent(target.name)
    const [rows] = await this.c.query(`SHOW CREATE ${what} ${ref}`)
    const row = (rows as Record<string, unknown>[])[0] ?? {}
    const key = Object.keys(row).find((k) => /^Create (Table|View|Procedure|Function|Event)$|^SQL Original Statement$/.test(k))
    if (!key || row[key] === null) throw new Error('No definition found (you may lack permission to see it)')
    return String(row[key]) + ';'
  }
}

/** One SELECT (or WITH / SHOW / DESCRIBE) and nothing after it */
function isSingleSelect(sql: string) {
  const bare = sql
    .replace(/(--|#)[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .trim()
    .replace(/;+$/, '')
  return /^(select|with|show|describe|desc)\b/i.test(bare) && !bare.includes(';')
}
