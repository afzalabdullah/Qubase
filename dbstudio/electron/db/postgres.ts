import { Client, ClientConfig } from 'pg'
import Cursor from 'pg-cursor'
import { BaseClient, DefinitionTarget } from './base'
import { sslOptions } from './ssl'
import type { ColumnInfo, ConnectionConfig, DbObject, ForeignKeyInfo, IndexInfo, TableInfo } from '../../shared/types'
import { createTableSql } from '../../shared/ddl'

export class PostgresClient extends BaseClient {
  protected readonly engine = 'postgres'
  private client: Client
  private options: ClientConfig

  constructor(config: ConnectionConfig) {
    super()
    this.options = {
      host: config.host || 'localhost',
      port: config.port || 5432,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: sslOptions(config)
    }
    this.client = new Client(this.options)
    // Without a handler, a dropped connection would crash the main process.
    this.client.on('error', () => {})
  }

  async connect() { await this.client.connect() }
  async disconnect() { await this.client.end() }

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }
  protected placeholder(i: number) { return `$${i}` }
  protected explainSql(text: string) { return { sql: `EXPLAIN (FORMAT JSON) ${text}`, format: 'json' as const } }

  /** Stop the running query from a second connection, like pgAdmin's Cancel. */
  async cancel() {
    const pid = (this.client as unknown as { processID?: number }).processID
    if (!pid) throw new Error('No query is running')
    const c = new Client(this.options)
    c.on('error', () => {})
    await c.connect()
    try { await c.query('SELECT pg_cancel_backend($1)', [pid]) } finally { await c.end().catch(() => {}) }
  }

  protected async run(sql: string, params?: unknown[]) {
    const all = await this.runAll(sql, params)
    return all[all.length - 1]
  }

  /**
   * Several statements in one go return one result each, like SSMS.
   * A single SELECT with a row limit is read through a cursor, so a huge table
   * only sends the rows we show.
   */
  protected async runMulti(sql: string, maxRows = 0) {
    if (maxRows > 0 && isSingleQuery(sql)) {
      const cursor = this.client.query(new Cursor(sql.trim().replace(/;+\s*$/, '')))
      try {
        const rows = await cursor.read(maxRows + 1)
        const fields = ((cursor as unknown as { _result?: { fields?: { name: string }[] } })._result?.fields ?? [])
        const columns = fields.length ? fields.map((f) => f.name) : rows[0] ? Object.keys(rows[0]) : []
        return [{ columns, rows: rows.slice(0, maxRows), affected: 0, truncated: rows.length > maxRows }]
      } finally {
        await cursor.close().catch(() => {})
      }
    }
    return this.runAll(sql)
  }

  private async runAll(sql: string, params?: unknown[]) {
    const res = await this.client.query({ text: sql, values: params })
    const list = (Array.isArray(res) ? res : [res]) as any[]
    return list.map((r) => ({
      columns: (r.fields ?? []).map((f: { name: string }) => f.name),
      rows: r.rows ?? [],
      affected: r.rowCount ?? 0,
      command: r.command as string | undefined
    }))
  }

  protected async transaction<T>(fn: () => Promise<T>) {
    await this.client.query('BEGIN')
    try {
      const r = await fn()
      await this.client.query('COMMIT')
      return r
    } catch (e) {
      await this.client.query('ROLLBACK')
      throw e
    }
  }

  async listDatabases() {
    const databases = await this.names(`SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY 1`)
    const [current] = await this.names(`SELECT current_database()`)
    return { databases, current }
  }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.client.query(
      `SELECT table_schema AS schema, table_name AS name,
              CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS type
         FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name`
    )
    return r.rows
  }

  /** Quoted "schema"."table" for ::regclass lookups */
  private rel(t: { schema?: string; name: string }) {
    return `${this.quoteIdent(t.schema || 'public')}.${this.quoteIdent(t.name)}`
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    try {
      const r = await this.client.query(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS "dataType",
                NOT a.attnotnull AS nullable,
                COALESCE((SELECT true FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)), false) AS "primaryKey",
                pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
                (COALESCE(pg_get_expr(d.adbin, d.adrelid), '') LIKE 'nextval(%') AS "autoIncrement"
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
        [this.rel(t)]
      )
      return r.rows
    } catch {
      // Fallback for PostgreSQL-compatible engines with a smaller catalog
      const r = await this.client.query(
        `SELECT c.column_name AS name, c.data_type AS "dataType", c.is_nullable = 'YES' AS nullable,
                c.column_default AS "defaultValue",
                EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                          JOIN information_schema.key_column_usage k ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
                           AND tc.table_name = c.table_name AND k.column_name = c.column_name) AS "primaryKey"
           FROM information_schema.columns c
          WHERE c.table_schema = $1 AND c.table_name = $2
          ORDER BY c.ordinal_position`,
        [t.schema || 'public', t.name]
      )
      return r.rows
    }
  }

  protected async indexes(t: TableInfo): Promise<IndexInfo[]> {
    const r = await this.client.query(
      `SELECT ic.relname AS name, i.indisunique AS "unique", i.indisprimary AS "primary",
              ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(n, ord)
                      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.n ORDER BY k.ord) AS columns
         FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = $1::regclass ORDER BY 1`, [this.rel(t)])
    return r.rows
  }

  protected async foreignKeys(t: TableInfo): Promise<ForeignKeyInfo[]> {
    const r = await this.client.query(
      `SELECT c.conname AS name, rn.nspname AS "refSchema", rc.relname AS "refTable",
              ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n, ord)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.ord) AS columns,
              ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n, ord)
                      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.ord) AS "refColumns"
         FROM pg_constraint c
         JOIN pg_class rc ON rc.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE c.contype = 'f' AND c.conrelid = $1::regclass ORDER BY 1`, [this.rel(t)])
    return r.rows
  }

  protected async tableTriggers(t: TableInfo): Promise<DbObject[]> {
    const r = await this.client.query(
      `SELECT tgname AS name, oid::text AS id FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY 1`, [this.rel(t)])
    return r.rows.map((x) => ({ kind: 'trigger' as const, schema: t.schema, name: x.name, table: t.name, id: x.id }))
  }

  async listObjects(): Promise<DbObject[]> {
    const user = `NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`
    // Objects created by extensions are left out (they would flood the list)
    const notExt = (cls: string, col: string) => `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = '${cls}'::regclass AND d.objid = ${col} AND d.deptype = 'e')`
    const parts = [
      `SELECT CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind, n.nspname AS schema,
              p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name, NULL AS "table", p.oid::text AS id
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname ${user} AND p.prokind IN ('f', 'p') AND ${notExt('pg_proc', 'p.oid')}`,
      `SELECT 'trigger', n.nspname, t.tgname, c.relname, t.oid::text
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND n.nspname ${user}`,
      `SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'matview' END, n.nspname, c.relname, NULL, c.oid::text
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('S', 'm') AND n.nspname ${user} AND ${notExt('pg_class', 'c.oid')}`,
      `SELECT 'type', n.nspname, t.typname, NULL, t.oid::text
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e' AND n.nspname ${user} AND ${notExt('pg_type', 't.oid')}`
    ]
    const out: DbObject[] = []
    // Run each part on its own so engines missing one catalog feature still list the rest
    for (const q of parts) {
      try { out.push(...(await this.client.query(`${q} ORDER BY 3`)).rows) } catch { /* not supported here */ }
    }
    return out.map((o) => ({ ...o, table: o.table ?? undefined }))
  }

  async getDefinition(target: DefinitionTarget): Promise<string> {
    const one = async (sql: string, params: unknown[]) => {
      const r = await this.client.query(sql, params)
      const v = r.rows[0] && Object.values(r.rows[0])[0]
      if (v === undefined || v === null) throw new Error('Definition not found')
      return String(v)
    }
    const ref = this.rel(target)
    const id = 'id' in target ? target.id : undefined
    switch (target.kind) {
      case 'table': {
        const s = await this.getStructure(target)
        return createTableSql('postgres', target, s)
      }
      case 'view': return `CREATE OR REPLACE VIEW ${ref} AS\n` + await one(`SELECT pg_get_viewdef($1::regclass, true)`, [ref])
      case 'matview': return `CREATE MATERIALIZED VIEW ${ref} AS\n` + await one(`SELECT pg_get_viewdef($1::regclass, true)`, [ref])
      case 'function':
      case 'procedure': return (await one(`SELECT pg_get_functiondef($1::oid)`, [id])) + ';'
      case 'trigger': {
        const def = await one(`SELECT pg_get_triggerdef($1::oid, true)`, [id])
        // Include the trigger function, which holds the actual logic
        const fn = await one(`SELECT pg_get_functiondef(tgfoid) FROM pg_trigger WHERE oid = $1::oid`, [id]).catch(() => '')
        return `${def};${fn ? `\n\n-- Trigger function\n${fn};` : ''}`
      }
      case 'sequence': {
        const r = await this.client.query(
          `SELECT data_type, start_value, increment_by, min_value, max_value, cycle FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2`,
          [target.schema || 'public', target.name])
        const x = r.rows[0]
        if (!x) throw new Error('Sequence not found')
        return `CREATE SEQUENCE ${ref}\n  AS ${x.data_type}\n  START WITH ${x.start_value}\n  INCREMENT BY ${x.increment_by}\n  MINVALUE ${x.min_value}\n  MAXVALUE ${x.max_value}\n  ${x.cycle ? 'CYCLE' : 'NO CYCLE'};`
      }
      case 'type':
        return `CREATE TYPE ${ref} AS ENUM (\n  ` + await one(
          `SELECT string_agg(quote_literal(enumlabel), E',\\n  ' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = $1::oid`, [id]) + '\n);'
      default: throw new Error(`Scripts for ${target.kind} are not available`)
    }
  }
}

/** True for one read-only statement (SELECT / WITH / VALUES / TABLE / SHOW) with no second statement. */
function isSingleQuery(sql: string) {
  const bare = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .trim()
    .replace(/;+$/, '')
  return /^(select|with|values|table|show)\b/i.test(bare) && !bare.includes(';') && !/^with\b[\s\S]*\b(insert|update|delete)\b/i.test(bare)
}
