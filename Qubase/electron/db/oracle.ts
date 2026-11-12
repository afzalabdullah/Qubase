import oracledb from 'oracledb'
import { BaseClient, DefinitionTarget, RunResult } from './base'
import type { ColumnInfo, ConnectionConfig, DbObject, ForeignKeyInfo, IndexInfo, ObjectKind, TableInfo } from '../../shared/types'

// Thin mode (the default) is pure JavaScript: no Oracle Instant Client needed.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
oracledb.fetchAsString = [oracledb.CLOB]

export class OracleClient extends BaseClient {
  private conn?: oracledb.Connection
  private inTx = false

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    this.conn = await oracledb.getConnection({
      user: this.config.user,
      password: this.config.password,
      connectString: `${this.config.host || 'localhost'}:${this.config.port || 1521}/${this.config.database || ''}`
    })
  }
  async disconnect() { await this.conn?.close() }

  private get c() {
    if (!this.conn) throw new Error('Not connected')
    return this.conn
  }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder(i: number) { return `:${i}` }
  protected selectTopSql(ref: string, n: number) { return `SELECT * FROM ${ref} FETCH FIRST ${n} ROWS ONLY` }
  protected pageSql(ref: string, where: string, order: string, o: { offset: number; limit: number }) {
    return `SELECT * FROM ${ref}${where}${order} OFFSET ${o.offset} ROWS FETCH NEXT ${o.limit} ROWS ONLY`
  }

  /** Oracle starts transactions on its own; Begin just turns off auto-commit until Commit or Rollback. */
  async transactionControl(action: 'begin' | 'commit' | 'rollback') {
    if (action === 'begin') { this.inTx = true; return }
    try { action === 'commit' ? await this.c.commit() : await this.c.rollback() } finally { this.inTx = false }
  }

  async explain(text: string) {
    const stmt = text.trim().replace(/;+\s*$/, '')
    await this.c.execute(`EXPLAIN PLAN FOR ${stmt}`)
    const r = await this.c.execute<Record<string, unknown>>(`SELECT plan_table_output AS line FROM TABLE(DBMS_XPLAN.DISPLAY())`)
    return { format: 'text' as const, plan: (r.rows ?? []).map((x) => String(Object.values(x)[0] ?? '')).join('\n') }
  }

  protected async run(text: string, params: unknown[] = []): Promise<RunResult> {
    // Oracle rejects a trailing semicolon on plain SQL (but PL/SQL blocks need theirs).
    const isPlsql = /^\s*(begin|declare|create\s+(or\s+replace\s+)?(procedure|function|package|trigger))/i.test(text)
    const stmt = isPlsql ? text : text.trim().replace(/;+\s*$/, '')
    const res = await this.c.execute<Record<string, unknown>>(stmt, params as oracledb.BindParameters, {
      autoCommit: !this.inTx
    })
    return {
      columns: (res.metaData ?? []).map((m) => m.name),
      rows: res.rows ?? [],
      affected: res.rowsAffected ?? 0
    }
  }

  protected async transaction<T>(fn: () => Promise<T>) {
    this.inTx = true
    try {
      const r = await fn()
      await this.c.commit()
      return r
    } catch (e) {
      await this.c.rollback()
      throw e
    } finally {
      this.inTx = false
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.run(
      `SELECT USER AS "schema", table_name AS "name", 'table' AS "type" FROM user_tables
       UNION ALL
       SELECT USER, view_name, 'view' FROM user_views
       ORDER BY 2`
    )
    return r.rows as unknown as TableInfo[]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const r = await this.run(
      `SELECT c.column_name AS "name",
              c.data_type || CASE
                WHEN c.data_type IN ('VARCHAR2','NVARCHAR2','CHAR','NCHAR','RAW') THEN '(' || c.char_length || ')'
                WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN '(' || c.data_precision || NVL2(NULLIF(c.data_scale, 0), ',' || c.data_scale, '') || ')'
                ELSE '' END AS "dataType",
              c.nullable AS "nullable", c.data_default AS "def", c.identity_column AS "ident",
              CASE WHEN EXISTS (
                SELECT 1 FROM all_constraints k
                JOIN all_cons_columns cc ON cc.owner = k.owner AND cc.constraint_name = k.constraint_name
                WHERE k.constraint_type = 'P' AND k.owner = c.owner AND k.table_name = c.table_name
                  AND cc.column_name = c.column_name) THEN 1 ELSE 0 END AS "pk"
         FROM all_tab_columns c
        WHERE c.owner = NVL(:1, USER) AND c.table_name = :2
        ORDER BY c.column_id`,
      [t.schema ?? null, t.name]
    )
    return r.rows.map((x: any) => ({ name: x.name, dataType: x.dataType, nullable: x.nullable === 'Y', primaryKey: x.pk === 1, defaultValue: x.def ? String(x.def).trim() : null, autoIncrement: x.ident === 'YES' }))
  }

  protected readonly engine = 'oracle'

  protected async indexes(t: TableInfo): Promise<IndexInfo[]> {
    const r = await this.run(
      `SELECT i.index_name AS "name", i.uniqueness AS "uniq", c.column_name AS "col",
              (SELECT COUNT(*) FROM all_constraints k WHERE k.owner = i.owner AND k.index_name = i.index_name AND k.constraint_type = 'P') AS "pk"
         FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
        WHERE i.table_owner = NVL(:1, USER) AND i.table_name = :2
        ORDER BY i.index_name, c.column_position`, [t.schema ?? null, t.name])
    return this.group(r.rows, (x) => ({ name: String(x.name), unique: x.uniq === 'UNIQUE', primary: Number(x.pk) > 0, columns: [] as string[] }), (ix, x) => ix.columns.push(String(x.col)))
  }

  protected async foreignKeys(t: TableInfo): Promise<ForeignKeyInfo[]> {
    const r = await this.run(
      `SELECT c.constraint_name AS "name", cc.column_name AS "col", r.owner AS "rs", r.table_name AS "rt", rc.column_name AS "rcol"
         FROM all_constraints c
         JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name
         JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
         JOIN all_cons_columns rc ON rc.owner = r.owner AND rc.constraint_name = r.constraint_name AND rc.position = cc.position
        WHERE c.constraint_type = 'R' AND c.owner = NVL(:1, USER) AND c.table_name = :2
        ORDER BY c.constraint_name, cc.position`, [t.schema ?? null, t.name])
    return this.group(r.rows, (x) => ({ name: String(x.name), refSchema: String(x.rs), refTable: String(x.rt), columns: [] as string[], refColumns: [] as string[] }),
      (fk, x) => { fk.columns.push(String(x.col)); fk.refColumns.push(String(x.rcol)) })
  }

  protected async tableTriggers(t: TableInfo): Promise<DbObject[]> {
    const r = await this.run(`SELECT owner AS "schema", trigger_name AS "name" FROM all_triggers WHERE table_owner = NVL(:1, USER) AND table_name = :2 ORDER BY 2`, [t.schema ?? null, t.name])
    return r.rows.map((x: any) => ({ kind: 'trigger' as const, schema: x.schema, name: x.name, table: t.name }))
  }

  async listObjects(): Promise<DbObject[]> {
    const kinds: Record<string, ObjectKind> = { PROCEDURE: 'procedure', FUNCTION: 'function', PACKAGE: 'package', TRIGGER: 'trigger', SEQUENCE: 'sequence', SYNONYM: 'synonym', 'MATERIALIZED VIEW': 'matview', TYPE: 'type' }
    const r = await this.run(
      `SELECT o.object_type AS "type", USER AS "schema", o.object_name AS "name",
              (SELECT t.table_name FROM user_triggers t WHERE t.trigger_name = o.object_name) AS "tbl"
         FROM user_objects o
        WHERE o.object_type IN ('PROCEDURE','FUNCTION','PACKAGE','TRIGGER','SEQUENCE','SYNONYM','MATERIALIZED VIEW','TYPE')
        ORDER BY o.object_name`)
    return r.rows.map((x: any) => ({ kind: kinds[x.type], schema: x.schema, name: x.name, table: x.tbl ?? undefined }))
  }

  /** DBMS_METADATA returns the exact DDL Oracle would use (packages include their body). */
  async getDefinition(target: DefinitionTarget): Promise<string> {
    const type = ({ table: 'TABLE', view: 'VIEW', procedure: 'PROCEDURE', function: 'FUNCTION', package: 'PACKAGE', trigger: 'TRIGGER', sequence: 'SEQUENCE', synonym: 'SYNONYM', matview: 'MATERIALIZED_VIEW', type: 'TYPE', index: 'INDEX' } as Record<string, string>)[target.kind]
    if (!type) throw new Error(`Scripts for ${target.kind} are not available`)
    const r = await this.run(`SELECT DBMS_METADATA.GET_DDL(:1, :2, NVL(:3, USER)) AS "ddl" FROM dual`, [type, target.name, target.schema ?? null])
    const ddl = (r.rows[0] as any)?.ddl
    if (!ddl) throw new Error('Definition not found')
    return String(ddl).trim()
  }
}
