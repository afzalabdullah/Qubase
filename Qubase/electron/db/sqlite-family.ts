import { BaseClient, DefinitionTarget } from './base'
import type { ColumnInfo, DbObject, ForeignKeyInfo, IndexInfo, TableInfo } from '../../shared/types'

/** Catalog queries shared by SQLite and LibSQL / Turso (same SQL, different drivers). */
export abstract class SqliteFamilyClient extends BaseClient {
  protected readonly engine: string = 'sqlite'

  protected quoteIdent(name: string) { return `"${name.replace(/"/g, '""')}"` }

  /** EXPLAIN QUERY PLAN rows (id, parent, detail) drawn as an indented tree */
  async explain(text: string) {
    const r = await this.run(`EXPLAIN QUERY PLAN ${text.trim().replace(/;+\s*$/, '')}`)
    const depth = new Map<number, number>()
    const lines = r.rows.map((row) => {
      const d = (depth.get(Number(row.parent)) ?? -1) + 1
      depth.set(Number(row.id), d)
      return `${'   '.repeat(d)}${d ? '└─ ' : ''}${row.detail}`
    })
    return { format: 'text' as const, plan: lines.join('\n') }
  }
  protected placeholder() { return '?' }

  async listTables(): Promise<TableInfo[]> {
    const r = await this.run(
      `SELECT name, type FROM sqlite_master
        WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'
        ORDER BY name`)
    return r.rows as unknown as TableInfo[]
  }

  async listColumns(t: TableInfo): Promise<ColumnInfo[]> {
    const cols = await this.run(`SELECT name, type, "notnull", pk, dflt_value FROM pragma_table_info(?)`, [t.name])
    const pkCount = cols.rows.filter((x: any) => Number(x.pk) > 0).length
    return cols.rows.map((x: any) => {
      const pk = Number(x.pk) > 0
      return {
        name: x.name,
        dataType: x.type,
        nullable: !x.notnull && !pk,
        primaryKey: pk,
        defaultValue: x.dflt_value ?? null,
        // A single INTEGER PRIMARY KEY is SQLite's rowid, so it numbers itself
        autoIncrement: pk && pkCount === 1 && /^integer$/i.test(x.type)
      }
    })
  }

  protected async indexes(t: TableInfo): Promise<IndexInfo[]> {
    const list = await this.run(`SELECT name, "unique", origin FROM pragma_index_list(?)`, [t.name])
    const out: IndexInfo[] = []
    for (const ix of list.rows as any[]) {
      const cols = await this.run(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, [ix.name])
      out.push({ name: ix.name, unique: !!Number(ix.unique), primary: ix.origin === 'pk', columns: cols.rows.map((c: any) => c.name) })
    }
    return out
  }

  protected async foreignKeys(t: TableInfo): Promise<ForeignKeyInfo[]> {
    const r = await this.run(`SELECT id, "table" AS rt, "from" AS col, "to" AS rcol FROM pragma_foreign_key_list(?) ORDER BY id, seq`, [t.name])
    return this.group(r.rows.map((x: any) => ({ ...x, name: `fk_${t.name}_${x.id}` })),
      (x) => ({ name: String(x.name), refTable: String(x.rt), columns: [] as string[], refColumns: [] as string[] }),
      (fk, x) => { fk.columns.push(String(x.col)); fk.refColumns.push(String(x.rcol ?? x.col)) })
  }

  protected async tableTriggers(t: TableInfo): Promise<DbObject[]> {
    const r = await this.run(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`, [t.name])
    return r.rows.map((x: any) => ({ kind: 'trigger' as const, name: x.name, table: t.name }))
  }

  async listObjects(): Promise<DbObject[]> {
    // Indexes SQLite creates for constraints have no SQL; only list ones users created
    const r = await this.run(
      `SELECT type AS kind, name, tbl_name AS tbl FROM sqlite_master
        WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY name`)
    return r.rows.map((x: any) => ({ kind: x.kind, name: x.name, table: x.tbl }))
  }

  async getDefinition(target: DefinitionTarget): Promise<string> {
    const r = await this.run(`SELECT sql FROM sqlite_master WHERE name = ?`, [target.name])
    const sql = (r.rows[0] as any)?.sql
    if (!sql) throw new Error('Definition not found')
    let out = String(sql) + ';'
    if (target.kind === 'table') {
      // Add the table's own indexes and triggers so the script recreates everything
      const extra = await this.run(`SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL`, [target.name])
      for (const x of extra.rows as any[]) out += `\n\n${x.sql};`
    }
    return out
  }
}
