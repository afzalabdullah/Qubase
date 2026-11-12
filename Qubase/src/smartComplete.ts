// Smarter SQL autocomplete: whole JOIN ... ON lines from foreign keys, and real column values after "col =".
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { ForeignKeyInfo, TableInfo } from '../shared/types'

const KEYWORDS = new Set(['where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'outer', 'on', 'group', 'order', 'having', 'limit', 'offset', 'union', 'set', 'values', 'as', 'with', 'natural', 'using', 'fetch', 'for', 'into', 'select', 'from', 'and', 'or'])
const DEFAULT_SCHEMA: Record<string, string> = { mssql: 'dbo', postgres: 'public' }

const clean = (s: string) => s.replace(/[[\]"`]/g, '')
const keyOf = (t: { schema?: string; name: string }) => `${(t.schema ?? '').toLowerCase()}.${t.name.toLowerCase()}`

/** Quote an identifier the way the engine expects */
export function quoteIdent(engine: string, name: string) {
  if (/^[a-z_][a-z0-9_]*$/i.test(name) && !KEYWORDS.has(name.toLowerCase())) return name
  if (engine === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  if (engine === 'mysql' || engine === 'clickhouse' || engine === 'bigquery') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

export interface Mention { table: TableInfo; alias: string }

/** Tables named after FROM / JOIN, with their aliases (alias = table name when none) */
export function mentionedTables(sql: string, tables: TableInfo[]): Mention[] {
  const out: Mention[] = []
  const re = /\b(?:from|join|update|into)\s+([\w.[\]"`$#@]+)(?:\s+(?:as\s+)?([a-z_][\w$#@]*))?/gi
  for (let m; (m = re.exec(sql));) {
    const parts = clean(m[1]).split('.')
    const name = parts.pop()!.toLowerCase(), schema = parts.pop()?.toLowerCase()
    const t = tables.find((x) => x.name.toLowerCase() === name && (!schema || (x.schema ?? '').toLowerCase() === schema))
    if (!t) continue
    const alias = m[2] && !KEYWORDS.has(m[2].toLowerCase()) ? m[2] : t.name
    if (!out.some((o) => o.alias.toLowerCase() === alias.toLowerCase())) out.push({ table: t, alias })
  }
  return out
}

/** Short alias from a table name: order_items → oi, customers → c; unique among the used ones */
function aliasFor(name: string, used: Set<string>) {
  const words = name.replace(/([a-z])([A-Z])/g, '$1_$2').split(/[_\W]+/).filter(Boolean)
  let a = (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 1)).toLowerCase()
  if (KEYWORDS.has(a) || !/^[a-z]/.test(a)) a = 't'
  let n = a, i = 2
  while (used.has(n)) n = `${a}${i++}`
  used.add(n)
  return n
}

interface JoinDeps {
  engine: string
  tables: () => TableInfo[]
  /** Foreign keys of every table (loaded once, on first use) */
  foreignKeys: () => Promise<Map<string, ForeignKeyInfo[]>>
}

/** After "JOIN ", offer complete "table alias ON alias.col = other.col" lines for tables linked by a foreign key */
export function joinSource(d: JoinDeps) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 300), ctx.pos)
    const m = /\bjoin\s+([\w.$#@]*)$/i.exec(before)
    if (!m) return null
    const tables = d.tables()
    const doc = ctx.state.doc.toString()
    const here = mentionedTables(doc, tables)
    if (!here.length) return null
    const fks = await d.foreignKeys()
    if (ctx.aborted) return null
    const used = new Set(here.map((h) => h.alias.toLowerCase()))
    const def = DEFAULT_SCHEMA[d.engine]
    const ref = (t: TableInfo) => (t.schema && t.schema !== def && tables.some((x) => x.name === t.name && x.schema !== t.schema) ? `${quoteIdent(d.engine, t.schema)}.` : t.schema && t.schema !== def ? `${quoteIdent(d.engine, t.schema)}.` : '') + quoteIdent(d.engine, t.name)
    const byKey = new Map(tables.map((t) => [keyOf(t), t]))
    const q = (s: string) => quoteIdent(d.engine, s)
    const on = (a: string, ac: string[], b: string, bc: string[]) => ac.map((c, i) => `${a}.${q(c)} = ${b}.${q(bc[i] ?? bc[0])}`).join(' AND ')
    const options: Completion[] = []
    const seen = new Set<string>()
    for (const h of here) {
      // h points at another table
      for (const fk of fks.get(keyOf(h.table)) ?? []) {
        const t = byKey.get(keyOf({ schema: fk.refSchema ?? h.table.schema, name: fk.refTable }))
        if (!t) continue
        const al = aliasFor(t.name, new Set(used))
        const label = `${ref(t)} ${al} ON ${on(al, fk.refColumns, h.alias, fk.columns)}`
        if (seen.has(label)) continue
        seen.add(label)
        options.push({ label, type: 'class', detail: `${h.table.name}.${fk.columns.join(', ')} → ${t.name}`, boost: 20, info: `Each ${h.table.name} row belongs to one ${t.name} (foreign key ${fk.name || ''})` })
      }
      // another table points at h
      for (const [k, list] of fks) {
        const t = byKey.get(k)
        if (!t) continue
        for (const fk of list) {
          if (keyOf({ schema: fk.refSchema ?? t.schema, name: fk.refTable }) !== keyOf(h.table)) continue
          const al = aliasFor(t.name, new Set(used))
          const label = `${ref(t)} ${al} ON ${on(al, fk.columns, h.alias, fk.refColumns)}`
          if (seen.has(label)) continue
          seen.add(label)
          options.push({ label, type: 'class', detail: `${t.name}.${fk.columns.join(', ')} → ${h.table.name}`, boost: 15, info: `${t.name} rows that belong to ${h.table.name} (foreign key ${fk.name || ''})` })
        }
      }
    }
    if (!options.length) return null
    return { from: ctx.pos - m[1].length, options, filter: true }
  }
}

interface ValueDeps {
  engine: string
  tables: () => TableInfo[]
  columnsOf: (t: TableInfo) => { name: string; dataType: string }[]
  run: (sql: string) => Promise<unknown[]>
}

/** After "col = ", "col <> ", "col LIKE " or "col IN (", offer the column's real values (up to 50 distinct) */
export function valueSource(d: ValueDeps) {
  const cache = new Map<string, Promise<unknown[]>>()
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.state.sliceDoc(Math.max(0, ctx.pos - 300), ctx.pos)
    const m = /([\w$#@]+(?:\.[\w$#@]+)?)\s*(?:=|<>|!=|\blike|\bin\s*\((?:[^)]*,)?)\s*('?)([^'\s,()]*)$/i.exec(before)
    if (!m) return null
    if (!m[2] && !m[3] && !ctx.explicit && !/[=(,]\s*$/.test(before)) return null
    const tables = d.tables()
    const here = mentionedTables(ctx.state.doc.toString(), tables)
    const [a, b] = m[1].includes('.') ? m[1].split('.') : [null, m[1]]
    const cands = a ? here.filter((h) => h.alias.toLowerCase() === a.toLowerCase()) : here
    const hit = cands.map((h) => ({ h, c: d.columnsOf(h.table).find((c) => c.name.toLowerCase() === b.toLowerCase()) })).find((x) => x.c)
    if (!hit || !hit.c) return null
    const { h, c } = hit
    const key = `${keyOf(h.table)}.${c.name}`
    if (!cache.has(key)) {
      const col = quoteIdent(d.engine, c.name)
      const from = (h.table.schema ? `${quoteIdent(d.engine, h.table.schema)}.` : '') + quoteIdent(d.engine, h.table.name)
      const sql = d.engine === 'mssql' ? `SELECT DISTINCT TOP 50 ${col} AS v FROM ${from} WHERE ${col} IS NOT NULL`
        : d.engine === 'oracle' ? `SELECT DISTINCT ${col} AS v FROM ${from} WHERE ${col} IS NOT NULL FETCH FIRST 50 ROWS ONLY`
        : `SELECT DISTINCT ${col} AS v FROM ${from} WHERE ${col} IS NOT NULL LIMIT 50`
      cache.set(key, d.run(sql).catch(() => []))
    }
    const values = await cache.get(key)!
    if (ctx.aborted || !values.length) return null
    const numeric = /int|num|dec|real|float|double|money|serial|bit/i.test(c.dataType)
    const options: Completion[] = values.map((v) => {
      const text = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v)
      const lit = numeric && /^-?\d+(\.\d+)?$/.test(text) ? text : `'${text.replace(/'/g, "''")}'`
      return { label: lit, type: 'constant', detail: `${h.table.name}.${c.name}`, boost: 30 }
    })
    return { from: ctx.pos - m[3].length - m[2].length, options, filter: true }
  }
}
