import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api'
import { BaseClient, DefinitionTarget, RunResult } from './base'
import type { ColumnInfo, ConnectionConfig, DbObject, ForeignKeyInfo, IndexInfo, TableInfo } from '../../shared/types'

export class DuckDbClient extends BaseClient {
  protected readonly engine = 'duckdb'
  private instance?: DuckDBInstance
  private conn?: DuckDBConnection

  constructor(private config: ConnectionConfig) { super() }

  async connect() {
    this.instance = await DuckDBInstance.create(this.config.file || ':memory:')
    this.conn = await this.instance.connect()
  }
  async disconnect() {
    this.conn?.closeSync()
    this.instance?.closeSync()
  }

  private get c() {
    if (!this.conn) throw new Error('Not connected')
    return this.conn
  }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder() { return '?' }

  protected async run(text: string, params: unknown[] = []): Promise<RunResult> {
    const reader = await this.c.runAndReadAll(text, params as never)
    // JSON form turns BIGINT, DECIMAL, dates etc. into display-safe values.
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[]
    const columns = reader.columnNames()
    // DML statements return a single "Count" column.
    if (columns.length === 1 && columns[0] === 'Count' && !/^\s*(select|with|from|show|describe|pragma)/i.test(text)) {
      return { columns: [], rows: [], affected: Number(rows[0]?.Count ?? 0) }
    }
    return { columns, rows, affected: 0 }
  }

  protected async transaction<T>(fn: () => Promise<T>) {
    await this.c.run('BEGIN TRANSACTION')
    try {
      const r = await fn()
      await this.c.run('COMMIT')
      return r
    } catch (e) {
      await this.c.run('ROLLBACK')
      throw e
    }
  }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.run(
      `SELECT table_schema AS schema, table_name AS name,
              CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS type
         FROM information_schema.tables
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        ORDER BY 1, 2`
    )
    return r.rows as unknown as TableInfo[]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const r = await this.run(
      `SELECT c.column_name AS name, c.data_type AS dataType, c.is_nullable = 'YES' AS nullable, c.column_default AS def,
              EXISTS (SELECT 1 FROM duckdb_constraints() k
                       WHERE k.constraint_type = 'PRIMARY KEY' AND k.schema_name = c.table_schema
                         AND k.table_name = c.table_name AND list_contains(k.constraint_column_names, c.column_name)) AS pk
         FROM information_schema.columns c
        WHERE c.table_schema = ? AND c.table_name = ?
        ORDER BY c.ordinal_position`,
      [t.schema || 'main', t.name]
    )
    return r.rows.map((x: any) => ({ name: x.name, dataType: x.dataType, nullable: !!x.nullable, primaryKey: !!x.pk, defaultValue: x.def ?? null }))
  }

  protected async indexes(t: TableInfo): Promise<IndexInfo[]> {
    const r = await this.run(
      `SELECT constraint_name AS name, constraint_type AS ty, constraint_column_names AS cols
         FROM duckdb_constraints() WHERE schema_name = ? AND table_name = ? AND constraint_type IN ('PRIMARY KEY', 'UNIQUE')`,
      [t.schema || 'main', t.name])
    const fromConstraints = r.rows.map((x: any) => ({ name: String(x.name), unique: true, primary: x.ty === 'PRIMARY KEY', columns: (x.cols ?? []) as string[] }))
    const ix = await this.run(`SELECT index_name AS name, is_unique AS u, expressions AS ex FROM duckdb_indexes() WHERE schema_name = ? AND table_name = ?`, [t.schema || 'main', t.name])
    return [...fromConstraints, ...ix.rows.map((x: any) => ({
      name: String(x.name), unique: !!x.u, primary: false,
      columns: String(x.ex ?? '').replace(/^\[|\]$/g, '').split(',').map((c) => c.trim().replace(/^'|'$/g, '')).filter(Boolean)
    }))]
  }

  protected async foreignKeys(t: TableInfo): Promise<ForeignKeyInfo[]> {
    const r = await this.run(
      `SELECT constraint_name AS name, constraint_column_names AS cols, referenced_table AS rt, referenced_column_names AS rcols
         FROM duckdb_constraints() WHERE schema_name = ? AND table_name = ? AND constraint_type = 'FOREIGN KEY'`, [t.schema || 'main', t.name])
    return r.rows.map((x: any) => ({ name: String(x.name), columns: x.cols ?? [], refTable: String(x.rt), refColumns: x.rcols ?? [] }))
  }

  async listObjects(): Promise<DbObject[]> {
    const parts = [
      `SELECT 'sequence' AS kind, schema_name AS schema, sequence_name AS name, NULL AS tbl FROM duckdb_sequences() WHERE NOT temporary`,
      `SELECT 'index' AS kind, schema_name AS schema, index_name AS name, table_name AS tbl FROM duckdb_indexes()`,
      `SELECT DISTINCT 'function' AS kind, schema_name AS schema, function_name AS name, NULL AS tbl FROM duckdb_functions() WHERE NOT internal AND function_type IN ('macro', 'table_macro')`,
      `SELECT 'type' AS kind, schema_name AS schema, type_name AS name, NULL AS tbl FROM duckdb_types() WHERE NOT internal AND logical_type = 'ENUM'`
    ]
    const out: DbObject[] = []
    // Each part on its own: catalog columns differ between DuckDB versions
    for (const q of parts) {
      try {
        const r = await this.run(q)
        out.push(...r.rows.map((x: any) => ({ kind: x.kind, schema: x.schema, name: x.name, table: x.tbl ?? undefined })))
      } catch { /* not available in this version */ }
    }
    return out.sort((x, y) => x.name.localeCompare(y.name))
  }

  /** DuckDB keeps the original CREATE statement for most objects. */
  async getDefinition(target: DefinitionTarget): Promise<string> {
    const s = target.schema || 'main'
    const q: Record<string, string> = {
      table: `SELECT sql FROM duckdb_tables() WHERE schema_name = ? AND table_name = ?`,
      view: `SELECT sql FROM duckdb_views() WHERE schema_name = ? AND view_name = ?`,
      index: `SELECT sql FROM duckdb_indexes() WHERE schema_name = ? AND index_name = ?`,
      sequence: `SELECT sql FROM duckdb_sequences() WHERE schema_name = ? AND sequence_name = ?`,
      function: `SELECT 'CREATE OR REPLACE MACRO ' || function_name || '(' || array_to_string(parameters, ', ') || ') AS ' || macro_definition FROM duckdb_functions() WHERE schema_name = ? AND function_name = ?`
    }
    if (!q[target.kind]) throw new Error(`Scripts for ${target.kind} are not available`)
    const r = await this.run(q[target.kind], [s, target.name])
    const v = r.rows[0] && Object.values(r.rows[0])[0]
    if (!v) throw new Error('Definition not found')
    return String(v).trim().replace(/;?$/, ';')
  }
}
