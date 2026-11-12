import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang } from '@codemirror/lang-sql'
import type { QueryResult, TableInfo, TableStructure } from '../../shared/types'
import { quote, sqlLiteral, tableRef } from '../../shared/ddl'
import { ResultView } from './ResultView'
import { IconArrowDown, IconArrowUp, IconCode, IconCopy, IconKey, IconLink, IconPlay, IconPlus, IconSearch, IconStar, IconTable, IconTrash, IconView, IconX } from './Icons'
import { errMsg } from '../util'
import { readSettings, useConn } from '../settings'
import { editorTheme } from '../editorThemes'
import { formatSqlText } from '../format'
import { saveQuery } from '../saved'

// ---------- model ----------
type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL'
type Agg = '' | 'COUNT' | 'COUNT DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
type Fn = '' | 'UPPER' | 'LOWER' | 'TRIM' | 'LENGTH' | 'YEAR' | 'MONTH' | 'DATE' | 'ROUND'
interface Node { alias: string; table: TableInfo; structure: TableStructure; x: number; y: number; compact?: boolean }
interface Join { id: string; type: JoinType; left: string; leftCol: string; right: string; rightCol: string; auto?: boolean }
/** One line of the SELECT list: a column (alias.col) or a free SQL expression */
interface Out { id: string; ref: string; expr?: string; fn: Fn; agg: Agg; as: string; show: boolean }
interface Filter { id: string; conj: 'AND' | 'OR'; col: string; agg: Agg; op: string; value: string; value2: string }
interface Sort { id: string; col: string; dir: 'ASC' | 'DESC' }
interface Design { name: string; tables: { label: string; x: number; y: number; alias: string }[]; joins: Join[]; outs: Out[]; filters: Filter[]; sorts: Sort[]; limit: number; offset: number; distinct: boolean }

const RESERVED = new Set(['as', 'at', 'by', 'do', 'go', 'if', 'in', 'is', 'no', 'of', 'on', 'or', 'to', 'up', 'all', 'and', 'any', 'asc', 'end', 'for', 'key', 'not', 'set', 'top', 'use'])
const OPS = ['=', '<>', '>', '>=', '<', '<=', 'contains', 'starts with', 'ends with', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL']
const AGGS: Agg[] = ['', 'COUNT', 'COUNT DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX']
const FNS: Fn[] = ['', 'UPPER', 'LOWER', 'TRIM', 'LENGTH', 'YEAR', 'MONTH', 'DATE', 'ROUND']
const JOIN_LABEL: Record<JoinType, string> = { INNER: 'Inner', LEFT: 'Left', RIGHT: 'Right', FULL: 'Full' }
const CARD_W = 220, HEAD_H = 32, ROW_H = 22
const label = (t: TableInfo) => (t.schema ? `${t.schema}.${t.name}` : t.name)
const uid = () => crypto.randomUUID()
const DESIGNS_KEY = 'qb:designs'
const loadDesigns = (): Design[] => { try { return JSON.parse(localStorage.getItem(DESIGNS_KEY) ?? '[]') } catch { return [] } }

/** Apply a column function in the engine's own dialect */
function applyFn(engine: string, fn: Fn, x: string): string {
  const sqlite = engine === 'sqlite' || engine === 'libsql'
  switch (fn) {
    case 'UPPER': case 'LOWER': case 'TRIM': return `${fn}(${x})`
    case 'LENGTH': return engine === 'mssql' ? `LEN(${x})` : `LENGTH(${x})`
    case 'ROUND': return `ROUND(${x}, 2)`
    case 'YEAR': case 'MONTH':
      if (engine === 'mssql' || engine === 'mysql') return `${fn}(${x})`
      if (sqlite) return `CAST(strftime('${fn === 'YEAR' ? '%Y' : '%m'}', ${x}) AS INTEGER)`
      return `EXTRACT(${fn} FROM ${x})`
    case 'DATE': return sqlite ? `date(${x})` : engine === 'mysql' ? `DATE(${x})` : `CAST(${x} AS DATE)`
    default: return x
  }
}
const applyAgg = (agg: Agg, x: string) => (!agg ? x : agg === 'COUNT DISTINCT' ? `COUNT(DISTINCT ${x})` : `${agg}(${x})`)
const hasAggText = (s: string) => /\b(count|sum|avg|min|max)\s*\(/i.test(s)

/** Build a SELECT visually: a diagram of tables and joins, a criteria grid, live SQL and results. */
export function QueryBuilder({ dark, onOpenQuery, onStatus }: { dark: boolean; onOpenQuery: (title: string, text: string) => void; onStatus: (s: string) => void }) {
  const { connId, engine } = useConn()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [search, setSearch] = useState('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [joins, setJoins] = useState<Join[]>([])
  const [outs, setOuts] = useState<Out[]>([])
  const [filters, setFilters] = useState<Filter[]>([])
  const [sorts, setSorts] = useState<Sort[]>([])
  const [limit, setLimit] = useState(100)
  const [offset, setOffset] = useState(0)
  const [distinct, setDistinct] = useState(false)
  const [tab, setTab] = useState<'columns' | 'joins' | 'filters' | 'sort' | 'options'>('columns')
  const [selJoin, setSelJoin] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [designs, setDesigns] = useState<Design[]>(loadDesigns)
  const [link, setLink] = useState<{ alias: string; col: string; x: number; y: number } | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<{ alias: string; dx: number; dy: number } | null>(null)

  useEffect(() => { window.db.listTables(connId).then(setTables).catch((e) => setError(errMsg(e))) }, [connId])

  const q = (n: string) => quote(engine, n)
  const allCols = nodes.flatMap((p) => p.structure.columns.map((c) => `${p.alias}.${c.name}`))
  const ref = (c: string) => {
    const i = c.indexOf('.')
    if (i > 0 && nodes.some((n) => n.alias === c.slice(0, i))) return `${c.slice(0, i)}.${q(c.slice(i + 1))}`
    return q(c)
  }
  const outExpr = (o: Out) => applyAgg(o.agg, applyFn(engine, o.fn, o.expr ?? ref(o.ref)))
  const outName = (o: Out) => o.as || (o.agg || o.fn ? `${(o.agg || o.fn).toLowerCase().replace(' ', '_')}_${(o.ref.split('.').pop() ?? 'expr')}` : '')
  const isSelected = (alias: string, col: string) => outs.some((o) => !o.expr && o.ref === `${alias}.${col}`)

  // ---------- tables ----------
  /** Next free spot: fill columns that fit the visible canvas, each card below the last one in its column */
  const placeFor = (n: number, list: Node[]) => {
    const per = Math.max(1, Math.floor(((canvas.current?.clientWidth ?? 900) - 16) / (CARD_W + 36)))
    const x = 16 + (n % per) * (CARD_W + 36)
    const below = list.filter((o) => Math.abs(o.x - x) < CARD_W).map((o) => o.y + HEAD_H + visibleCols(o).length * ROW_H + 30)
    return { x, y: below.length ? Math.max(...below) : 16 }
  }

  const addTable = async (t: TableInfo, at?: { x: number; y: number }, presetAlias?: string, list = nodes): Promise<Node | null> => {
    setError('')
    try {
      const structure = await window.db.getStructure(connId, t)
      const base = t.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toLowerCase() || 't'
      let alias = presetAlias ?? (RESERVED.has(base) ? `${base}1` : base), n = 2
      while (list.some((p) => p.alias === alias)) alias = `${base}${n++}`
      const node: Node = { alias, table: t, structure, ...(at ?? placeFor(list.length, list)) }
      if (!presetAlias) {
        const same = (a: { schema?: string; name: string }, b: { refSchema?: string; refTable: string }) =>
          a.name.toLowerCase() === b.refTable.toLowerCase() && (!b.refSchema || !a.schema || a.schema.toLowerCase() === b.refSchema.toLowerCase())
        const found: Join[] = []
        for (const o of list) {
          for (const fk of structure.foreignKeys) if (same(o.table, fk)) found.push({ id: uid(), type: 'INNER', left: o.alias, leftCol: fk.refColumns[0], right: alias, rightCol: fk.columns[0], auto: true })
          for (const fk of o.structure.foreignKeys) if (same(t, fk)) found.push({ id: uid(), type: 'INNER', left: o.alias, leftCol: fk.columns[0], right: alias, rightCol: fk.refColumns[0], auto: true })
        }
        if (found.length) setJoins((j) => [...j, found[0]])
        else if (list.length) onStatus(`No foreign key links ${label(t)} yet. Drag a column onto another table's column to join them.`)
      }
      setNodes((l) => [...l, node])
      return node
    } catch (e) { setError(errMsg(e)); return null }
  }

  const removeTable = (alias: string) => {
    setNodes((l) => l.filter((p) => p.alias !== alias))
    setJoins((j) => j.filter((x) => x.left !== alias && x.right !== alias))
    setOuts((o) => o.filter((x) => x.expr || !x.ref.startsWith(alias + '.')))
    setFilters((f) => f.filter((x) => !x.col.startsWith(alias + '.')))
    setSorts((s) => s.filter((x) => !x.col.startsWith(alias + '.')))
  }

  const toggleCol = (alias: string, col: string) => {
    const r = `${alias}.${col}`
    setOuts((l) => (l.some((o) => !o.expr && o.ref === r) ? l.filter((o) => o.expr || o.ref !== r) : [...l, { id: uid(), ref: r, fn: '', agg: '', as: '', show: true }]))
  }
  const setAll = (p: Node, on: boolean) => setOuts((l) => {
    const rest = l.filter((o) => o.expr || !o.ref.startsWith(p.alias + '.'))
    return on ? [...rest, ...p.structure.columns.map((c) => ({ id: uid(), ref: `${p.alias}.${c.name}`, fn: '' as Fn, agg: '' as Agg, as: '', show: true }))] : rest
  })

  /** Tables linked by a foreign key to what is on the canvas but not added yet */
  const related = useMemo(() => {
    const onCanvas = new Set(nodes.map((n) => label(n.table).toLowerCase()))
    const names = new Set(nodes.flatMap((n) => n.structure.foreignKeys.map((fk) => (fk.refSchema ? `${fk.refSchema}.${fk.refTable}` : fk.refTable).toLowerCase())))
    return tables.filter((t) => !onCanvas.has(label(t).toLowerCase()) && (names.has(label(t).toLowerCase()) || names.has(t.name.toLowerCase())))
  }, [nodes, tables])

  // ---------- canvas: drag cards, drag columns to join ----------
  const visibleCols = (p: Node) => (p.compact ? p.structure.columns.filter((c) => c.primaryKey || isSelected(p.alias, c.name) || joins.some((j) => (j.left === p.alias && j.leftCol === c.name) || (j.right === p.alias && j.rightCol === c.name))) : p.structure.columns)
  const anchor = (alias: string, col: string, side: 'l' | 'r') => {
    const p = nodes.find((n) => n.alias === alias)
    if (!p) return null
    const i = visibleCols(p).findIndex((c) => c.name === col)
    return { x: p.x + (side === 'r' ? CARD_W : 0), y: p.y + (i < 0 ? HEAD_H / 2 : HEAD_H + i * ROW_H + ROW_H / 2) }
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left + canvas.current!.scrollLeft, y: e.clientY - r.top + canvas.current!.scrollTop }
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const { x, y } = local(e)
      const d = drag.current
      setNodes((l) => l.map((n) => (n.alias === d.alias ? { ...n, x: Math.max(0, x - d.dx), y: Math.max(0, y - d.dy) } : n)))
    } else if (link) setLink({ ...link, ...local(e) })
  }
  const endPointer = () => { drag.current = null; setLink(null) }
  const dropOnCol = (alias: string, col: string) => {
    if (!link || link.alias === alias) return
    const j: Join = { id: uid(), type: 'INNER', left: link.alias, leftCol: link.col, right: alias, rightCol: col }
    setJoins((l) => [...l, j]); setSelJoin(j.id); setTab('joins')
  }
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const name = e.dataTransfer.getData('text/qb-table')
    const t = tables.find((x) => label(x) === name)
    if (t) { const p = local(e); addTable(t, { x: Math.max(0, p.x - CARD_W / 2), y: Math.max(0, p.y - 14) }) }
  }

  // ---------- SQL ----------
  const build = (withLimit: boolean) => {
    if (!nodes.length) return ''
    const valid = outs.filter((o) => o.expr || o.ref)
    const shown = valid.filter((o) => o.show)
    // Results are keyed by column name, so every output column needs a unique name,
    // otherwise e.g. orders.id and customers.id overwrite each other and values land in the wrong column.
    const used = new Set<string>()
    const unique = (want: string, alt: string) => {
      let n = used.has(want.toLowerCase()) ? alt : want, k = 2
      while (used.has(n.toLowerCase())) n = `${alt}_${k++}`
      used.add(n.toLowerCase())
      return n
    }
    const sel = shown.map((o) => {
      const natural = o.expr ? 'expr' : o.ref.slice(o.ref.indexOf('.') + 1)
      const want = outName(o) || natural
      const n = unique(want, `${o.expr ? 'expr' : o.ref.split('.')[0]}_${want}`)
      return n === natural && !o.expr && !o.as ? outExpr(o) : `${outExpr(o)} AS ${q(n)}`
    })
    // Nothing picked with several tables: list every column, renaming clashes (alias_column)
    if (!sel.length && nodes.length > 1) for (const p of nodes) for (const c of p.structure.columns) {
      const n = unique(c.name, `${p.alias}_${c.name}`)
      sel.push(n === c.name ? `${p.alias}.${q(c.name)}` : `${p.alias}.${q(c.name)} AS ${q(n)}`)
    }
    const anyAgg = outs.some((o) => o.agg || (o.expr && hasAggText(o.expr))) || filters.some((f) => f.agg)
    const groupBy = anyAgg ? valid.filter((o) => !o.agg && !(o.expr && hasAggText(o.expr))).map((o) => applyFn(engine, o.fn, o.expr ?? ref(o.ref))) : []
    if (!sel.length) sel.push('*')
    const from = [`${tableRef(engine, nodes[0].table)} ${nodes[0].alias}`]
    const joined = new Set([nodes[0].alias])
    let pending = nodes.slice(1)
    // Add tables in an order where each one joins to something already in FROM
    while (pending.length) {
      const next = pending.find((p) => joins.some((j) => (j.left === p.alias && joined.has(j.right)) || (j.right === p.alias && joined.has(j.left)))) ?? pending[0]
      const js = joins.filter((j) => (j.left === next.alias && joined.has(j.right)) || (j.right === next.alias && joined.has(j.left)))
      const conds = js.filter((j) => j.leftCol && j.rightCol).map((j) => `${j.left}.${q(j.leftCol)} = ${j.right}.${q(j.rightCol)}`)
      // The join type is written from the side of the table that was there first
      let type = js[0]?.type ?? 'INNER'
      if (js[0] && js[0].left === next.alias) type = type === 'LEFT' ? 'RIGHT' : type === 'RIGHT' ? 'LEFT' : type
      const kw = type === 'FULL' ? 'FULL OUTER' : type
      from.push(conds.length ? `${kw} JOIN ${tableRef(engine, next.table)} ${next.alias} ON ${conds.join(' AND ')}` : `CROSS JOIN ${tableRef(engine, next.table)} ${next.alias}`)
      joined.add(next.alias)
      pending = pending.filter((p) => p !== next)
    }
    const value = (v: string) => { const t = v.trim(); return t.startsWith('=') ? t.slice(1).trim() : /^-?\d+(\.\d+)?$/.test(t) ? t : sqlLiteral(v) }
    const cond = (f: Filter) => {
      const l = applyAgg(f.agg, ref(f.col))
      const list = () => f.value.split(',').map((x) => value(x)).join(', ')
      switch (f.op) {
        case 'IS NULL': case 'IS NOT NULL': return `${l} ${f.op}`
        case 'IN': case 'NOT IN': return `${l} ${f.op} (${list()})`
        case 'BETWEEN': return `${l} BETWEEN ${value(f.value)} AND ${value(f.value2)}`
        case 'contains': return `${l} LIKE ${sqlLiteral(`%${f.value}%`)}`
        case 'starts with': return `${l} LIKE ${sqlLiteral(`${f.value}%`)}`
        case 'ends with': return `${l} LIKE ${sqlLiteral(`%${f.value}`)}`
        default: return `${l} ${f.op} ${value(f.value)}`
      }
    }
    const join = (fs: Filter[]) => fs.map((f, i) => (i ? `${f.conj} ` : '') + cond(f)).join('\n  ')
    const where = filters.filter((f) => f.col && !f.agg)
    const having = filters.filter((f) => f.col && f.agg)
    const order = sorts.filter((s) => s.col).map((s) => `${outs.some((o) => outName(o) === s.col) ? q(s.col) : ref(s.col)} ${s.dir}`)
    const n = withLimit ? Math.max(0, Math.floor(limit)) : 0
    const off = withLimit ? Math.max(0, Math.floor(offset)) : 0
    const top = n && !off && engine === 'mssql' ? `TOP ${n} ` : ''
    let text = `SELECT ${distinct ? 'DISTINCT ' : ''}${top}${sel.join(', ')}\nFROM ${from.join('\n')}`
    if (where.length) text += `\nWHERE ${join(where)}`
    if (groupBy.length) text += `\nGROUP BY ${groupBy.join(', ')}`
    if (having.length) text += `\nHAVING ${join(having)}`
    if (order.length) text += `\nORDER BY ${order.join(', ')}`
    if (engine === 'mssql' && off) text += `${order.length ? '' : '\nORDER BY (SELECT NULL)'}\nOFFSET ${off} ROWS${n ? ` FETCH NEXT ${n} ROWS ONLY` : ''}`
    else if (engine === 'oracle' && (n || off)) text += `${off ? `\nOFFSET ${off} ROWS` : ''}${n ? `\nFETCH ${off ? 'NEXT' : 'FIRST'} ${n} ROWS ONLY` : ''}`
    else if (engine !== 'mssql' && n) text += `\nLIMIT ${n}${off ? ` OFFSET ${off}` : ''}`
    else if (engine !== 'mssql' && off) text += `\nLIMIT ${engine === 'mysql' ? '18446744073709551615' : 'ALL'} OFFSET ${off}`
    try { return formatSqlText(text, engine) } catch { return text }
  }
  const sql = useMemo(() => build(true), [nodes, joins, outs, filters, sorts, limit, offset, distinct, engine]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (text = sql, name = 'Built query') => {
    if (!text) return
    setBusy(true); setError('')
    try {
      const [r] = await window.db.queryMulti(connId, text, 10000)
      if (name === 'count') onStatus(`The query returns ${String(Object.values(r.rows[0] ?? {})[0] ?? '?')} rows in total`)
      else { setResult(r); onStatus(`${r.rowCount.toLocaleString()} rows · ${r.durationMs} ms`) }
    } catch (e) { setError(errMsg(e)); if (name !== 'count') setResult(null) } finally { setBusy(false) }
  }
  const countRows = () => run(`SELECT COUNT(*) AS row_count FROM (\n${build(false)}\n) qb_count`, 'count')

  const clear = () => { setNodes([]); setJoins([]); setOuts([]); setFilters([]); setSorts([]); setResult(null); setError(''); setOffset(0); setDistinct(false) }

  // ---------- saved designs ----------
  /** Name box shown under the toolbar (window.prompt does not work in Electron) */
  const [saveName, setSaveName] = useState<string | null>(null)
  const openSave = () => { if (nodes.length) setSaveName(nodes.map((n) => n.table.name).join(' + ')) }
  const [saveWhat, setSaveWhat] = useState(() => { try { return JSON.parse(localStorage.getItem('qb:saveWhat') ?? '') as { design: boolean; query: boolean } } catch { return { design: true, query: true } } })
  /** Save the design (layout, joins, filters…) and/or the SQL to Saved queries, under one name */
  const doSave = () => {
    const name = saveName?.trim()
    if (!name || (!saveWhat.design && !saveWhat.query)) return
    const done: string[] = []
    if (saveWhat.design) {
      const d: Design = { name, tables: nodes.map((n) => ({ label: label(n.table), x: n.x, y: n.y, alias: n.alias })), joins, outs, filters, sorts, limit, offset, distinct }
      const next = [...designs.filter((x) => x.name !== name), d]
      setDesigns(next)
      try { localStorage.setItem(DESIGNS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      done.push('design')
    }
    if (saveWhat.query && sql) { saveQuery(name, sql, engine); done.push('query') }
    try { localStorage.setItem('qb:saveWhat', JSON.stringify(saveWhat)) } catch { /* ignore */ }
    setSaveName(null)
    onStatus(`Saved “${name}” (${done.join(' and ')})`)
  }
  const loadDesign = async (d: Design) => {
    clear()
    const list: Node[] = []
    for (const t of d.tables) {
      const info = tables.find((x) => label(x) === t.label)
      if (!info) { setError(`Table ${t.label} is not in this database`); continue }
      const n = await addTable(info, { x: t.x, y: t.y }, t.alias, list)
      if (n) list.push(n)
    }
    setJoins(d.joins); setOuts(d.outs); setFilters(d.filters); setSorts(d.sorts); setLimit(d.limit); setOffset(d.offset); setDistinct(d.distinct)
  }
  const deleteDesign = (name: string) => {
    const next = designs.filter((x) => x.name !== name)
    setDesigns(next)
    try { localStorage.setItem(DESIGNS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // ---------- small helpers for the grid ----------
  const patch = <T extends { id: string }>(set: React.Dispatch<React.SetStateAction<T[]>>, id: string, p: Partial<T>) => set((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const move = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, d: number) => set((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n })
  const colSelect = (value: string, onChange: (v: string) => void, extra: string[] = []) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">column…</option>
      {extra.length > 0 && <optgroup label="Output names">{extra.map((c) => <option key={'o:' + c} value={c}>{c}</option>)}</optgroup>}
      {nodes.map((p) => <optgroup key={p.alias} label={`${label(p.table)} (${p.alias})`}>{p.structure.columns.map((c) => <option key={c.name} value={`${p.alias}.${c.name}`}>{p.alias}.{c.name}</option>)}</optgroup>)}
    </select>
  )

  const shown = tables.filter((t) => label(t).toLowerCase().includes(search.toLowerCase())).slice(0, 400)
  const bySchema = shown.reduce<Map<string, TableInfo[]>>((m, t) => m.set(t.schema ?? '', [...(m.get(t.schema ?? '') ?? []), t]), new Map())
  const tableBtn = (t: TableInfo, star = false) => (
    <button key={(star ? 'r:' : '') + label(t)} draggable onDragStart={(e) => e.dataTransfer.setData('text/qb-table', label(t))} onClick={() => addTable(t)} title="Click or drag onto the diagram">
      {star ? <IconLink width={12} height={12} /> : t.type === 'view' ? <IconView width={12} height={12} /> : <IconTable width={12} height={12} />}
      <span className="grow ellipsis">{star ? label(t) : t.name}</span>
      {nodes.some((n) => label(n.table) === label(t)) && <span className="qb-dot" title="On the diagram" />}
    </button>
  )
  const canvasSize = nodes.reduce((s, n) => ({ w: Math.max(s.w, n.x + CARD_W + 40), h: Math.max(s.h, n.y + HEAD_H + visibleCols(n).length * ROW_H + 40) }), { w: 0, h: 0 })
  const outNames = outs.map(outName).filter(Boolean)

  return (
    <div className="qb" tabIndex={-1} onKeyDown={(e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run() }
      if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); openSave() }
    }}>
      <aside className="qb-tables">
        <div className="qb-search"><IconSearch width={13} height={13} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Find among ${tables.length} tables`} /></div>
        <div className="qb-table-list">
          {related.length > 0 && !search && <>
            <div className="qb-list-head">Related to the diagram</div>
            {related.slice(0, 12).map((t) => tableBtn(t, true))}
          </>}
          {[...bySchema.entries()].map(([s, list]) => [
            (bySchema.size > 1 || s) && <div key={'s:' + s} className="qb-list-head">{s || 'Tables'} <span className="muted">{list.length}</span></div>,
            ...list.map((t) => tableBtn(t))
          ])}
          {!shown.length && <p className="muted small-text qb-pad">No table matches “{search}”.</p>}
        </div>
        <div className="qb-designs">
          <div className="qb-list-head"><IconStar width={12} height={12} /> Saved designs</div>
          {designs.length === 0 && <p className="muted small-text qb-pad">Save a design to reuse it later.</p>}
          {designs.map((d) => (
            <div key={d.name} className="qb-design-item">
              <button className="grow ellipsis" onClick={() => loadDesign(d)} title="Open this design">{d.name}</button>
              <button className="icon-btn" title="Delete design" onClick={() => deleteDesign(d.name)}><IconX width={11} height={11} /></button>
            </div>
          ))}
        </div>
      </aside>

      <div className="qb-main">
        <div className="toolbar qb-toolbar">
          <strong>Query builder</strong>
          <span className="muted small-text">{nodes.length ? `${nodes.length} table${nodes.length > 1 ? 's' : ''} · ${joins.length} join${joins.length === 1 ? '' : 's'} · ${outs.length || 'all'} columns` : 'Add tables from the left'}</span>
          <div className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => run()} disabled={!sql || busy} title="Ctrl+Enter"><IconPlay width={12} height={12} /> {busy ? 'Running…' : 'Run'}</button>
          <button className="btn btn-sm" onClick={countRows} disabled={!sql || busy} title="How many rows the whole query returns (ignores the limit)">Count rows</button>
          <button className="btn btn-sm" disabled={!sql} onClick={() => onOpenQuery('Built query', sql)}><IconCode width={13} height={13} /> Open in query tab</button>
          <button className="btn btn-sm" disabled={!nodes.length} onClick={openSave} title="Ctrl+S"><IconStar width={12} height={12} /> Save</button>
          <button className="btn btn-sm" disabled={!nodes.length} onClick={clear}>Clear</button>
        </div>

        {saveName !== null && (
          <form className="qb-savebar" onSubmit={(e) => { e.preventDefault(); doSave() }}>
            <span className="small-text">Name</span>
            <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setSaveName(null) }} placeholder="e.g. Sales by city" />
            <label className="check small-text" title="Tables, layout, joins, columns, filters and sort: reopen it here to keep editing">
              <input type="checkbox" checked={saveWhat.design} onChange={(e) => setSaveWhat((w) => ({ ...w, design: e.target.checked }))} /> Design</label>
            <label className="check small-text" title="The SQL, in the Saved queries library (query tabs and Ctrl+K)">
              <input type="checkbox" checked={saveWhat.query} onChange={(e) => setSaveWhat((w) => ({ ...w, query: e.target.checked }))} /> Saved query</label>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!saveName.trim() || (!saveWhat.design && !saveWhat.query)}>Save</button>
            {saveWhat.design && designs.some((d) => d.name === saveName.trim()) && <span className="muted small-text">Replaces the design with this name</span>}
            <span className="spacer" />
            <button type="button" className="icon-btn" onClick={() => setSaveName(null)} title="Cancel (Esc)"><IconX width={12} height={12} /></button>
          </form>
        )}
        <div className="qb-body">
          <div className="qb-left">
            <div ref={canvas} className={`qb-canvas ${link ? 'linking' : ''}`} onPointerMove={onMove} onPointerUp={endPointer} onPointerLeave={endPointer}
              onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop} onClick={(e) => { if (e.target === e.currentTarget) setSelJoin('') }}>
              {!nodes.length && (
                <div className="qb-empty">
                  <IconTable width={28} height={28} />
                  <strong>Drag tables here, or click them on the left</strong>
                  <span className="muted small-text">Tables linked by foreign keys are joined for you. Drag a column onto a column of another table to join them yourself.</span>
                </div>
              )}
              <svg className="qb-lines" width={Math.max(canvasSize.w, 10)} height={Math.max(canvasSize.h, 10)}>
                {joins.map((j) => {
                  const a = nodes.find((n) => n.alias === j.left), b = nodes.find((n) => n.alias === j.right)
                  if (!a || !b) return null
                  // Cards side by side: facing edges. Cards stacked: both right edges, with a loop outwards.
                  const stacked = Math.abs(a.x - b.x) < CARD_W
                  const aRight = a.x < b.x
                  const p1 = anchor(j.left, j.leftCol, stacked || aRight ? 'r' : 'l'), p2 = anchor(j.right, j.rightCol, stacked || !aRight ? 'r' : 'l')
                  if (!p1 || !p2) return null
                  const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2) * (aRight ? 1 : -1)
                  const loop = 40 + Math.min(60, Math.abs(p2.y - p1.y) / 6)
                  const d = stacked
                    ? `M${p1.x},${p1.y} C${p1.x + loop},${p1.y} ${p2.x + loop},${p2.y} ${p2.x},${p2.y}`
                    : `M${p1.x},${p1.y} C${p1.x + dx},${p1.y} ${p2.x - dx},${p2.y} ${p2.x},${p2.y}`
                  const mx = stacked ? Math.max(p1.x, p2.x) + loop * 0.75 : (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2
                  const on = selJoin === j.id
                  return (
                    <g key={j.id} className={`qb-join ${on ? 'on' : ''}`} onClick={() => { setSelJoin(j.id); setTab('joins') }}>
                      <path d={d} className="hit" />
                      <path d={d} className={`line ${j.type !== 'INNER' ? 'outer' : ''}`} />
                      <circle cx={p1.x} cy={p1.y} r={3.5} /><circle cx={p2.x} cy={p2.y} r={3.5} />
                      <g transform={`translate(${mx},${my})`}>
                        <rect x={-22} y={-9} width={44} height={18} rx={9} />
                        <text textAnchor="middle" dy={4}>{JOIN_LABEL[j.type]}</text>
                      </g>
                    </g>
                  )
                })}
                {link && (() => { const p = anchor(link.alias, link.col, 'r'); return p ? <path d={`M${p.x},${p.y} L${link.x},${link.y}`} className="qb-link-temp" /> : null })()}
              </svg>
              {nodes.map((p) => {
                const cols = visibleCols(p)
                const count = p.structure.columns.filter((c) => isSelected(p.alias, c.name)).length
                return (
                  <div key={p.alias} className="qb-card" style={{ left: p.x, top: p.y, width: CARD_W }}>
                    <div className="qb-card-head" onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest('button,input')) return
                      const pt = local(e); drag.current = { alias: p.alias, dx: pt.x - p.x, dy: pt.y - p.y }
                    }}>
                      <input type="checkbox" title="All columns" checked={count === p.structure.columns.length && count > 0}
                        ref={(el) => { if (el) el.indeterminate = count > 0 && count < p.structure.columns.length }} onChange={(e) => setAll(p, e.target.checked)} />
                      <strong className="grow ellipsis" title={label(p.table)}>{p.table.name}</strong>
                      <span className="qb-alias">{p.alias}</span>
                      <button className="icon-btn" title={p.compact ? 'Show all columns' : 'Show only keys and used columns'} onClick={() => setNodes((l) => l.map((n) => (n.alias === p.alias ? { ...n, compact: !n.compact } : n)))}>{p.compact ? '▸' : '▾'}</button>
                      <button className="icon-btn" title="Remove from the query" onClick={() => removeTable(p.alias)}><IconX width={12} height={12} /></button>
                    </div>
                    {cols.map((c) => {
                      const fk = p.structure.foreignKeys.some((f) => f.columns.includes(c.name))
                      return (
                        <div key={c.name} className={`qb-col ${isSelected(p.alias, c.name) ? 'on' : ''} ${link && link.alias !== p.alias ? 'target' : ''}`} style={{ height: ROW_H }}
                          onPointerUp={() => dropOnCol(p.alias, c.name)}>
                          <input type="checkbox" checked={isSelected(p.alias, c.name)} onChange={() => toggleCol(p.alias, c.name)} />
                          <span className="qb-col-icon">{c.primaryKey ? <IconKey width={11} height={11} /> : fk ? <IconLink width={11} height={11} /> : null}</span>
                          <span className="grow ellipsis" onClick={() => toggleCol(p.alias, c.name)}>{c.name}</span>
                          <span className="qb-type">{c.dataType.toLowerCase()}</span>
                          <span className="qb-handle" title="Drag onto another table's column to join"
                            onPointerDown={(e) => { e.stopPropagation(); setLink({ alias: p.alias, col: c.name, ...local(e) }) }} />
                        </div>
                      )
                    })}
                    {p.compact && cols.length < p.structure.columns.length && <div className="qb-more muted small-text">{p.structure.columns.length - cols.length} more columns</div>}
                  </div>
                )
              })}
            </div>

            <div className="qb-grid">
              <div className="qb-tabs">
                {([['columns', `Columns${outs.length ? ` (${outs.length})` : ''}`], ['joins', `Joins${joins.length ? ` (${joins.length})` : ''}`], ['filters', `Filters${filters.length ? ` (${filters.length})` : ''}`], ['sort', `Sort${sorts.length ? ` (${sorts.length})` : ''}`], ['options', 'Limit & options']] as const).map(([k, l]) => (
                  <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              <div className="qb-tab-body">
                {tab === 'columns' && (
                  <>
                    {outs.length === 0 && <p className="muted small-text">No columns picked, so every column is returned. Tick columns in the diagram to choose them.</p>}
                    {outs.length > 0 && (
                      <table className="qb-table">
                        <thead><tr><th /><th>Column</th><th>Function</th><th>Aggregate</th><th>Output name</th><th title="Include in the result">Show</th><th /></tr></thead>
                        <tbody>
                          {outs.map((o, i) => (
                            <tr key={o.id}>
                              <td className="qb-order">
                                <button className="icon-btn" disabled={!i} onClick={() => move(setOuts, i, -1)} title="Move up"><IconArrowUp width={11} height={11} /></button>
                                <button className="icon-btn" disabled={i === outs.length - 1} onClick={() => move(setOuts, i, 1)} title="Move down"><IconArrowDown width={11} height={11} /></button>
                              </td>
                              <td>{o.expr !== undefined
                                ? <input className="mono wide" value={o.expr} onChange={(e) => patch(setOuts, o.id, { expr: e.target.value })} placeholder="e.g. price * quantity" />
                                : colSelect(o.ref, (v) => patch(setOuts, o.id, { ref: v }))}</td>
                              <td><select value={o.fn} onChange={(e) => patch(setOuts, o.id, { fn: e.target.value as Fn })}>{FNS.map((f) => <option key={f} value={f}>{f || '—'}</option>)}</select></td>
                              <td><select value={o.agg} onChange={(e) => patch(setOuts, o.id, { agg: e.target.value as Agg })}>{AGGS.map((a) => <option key={a} value={a}>{a || 'group / value'}</option>)}</select></td>
                              <td><input value={o.as} onChange={(e) => patch(setOuts, o.id, { as: e.target.value })} placeholder={outName(o) || 'optional'} /></td>
                              <td><input type="checkbox" checked={o.show} onChange={(e) => patch(setOuts, o.id, { show: e.target.checked })} /></td>
                              <td><button className="icon-btn" onClick={() => setOuts((l) => l.filter((x) => x.id !== o.id))} title="Remove"><IconTrash width={13} height={13} /></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="qb-row">
                      <button className="btn btn-sm" disabled={!nodes.length} onClick={() => setOuts((l) => [...l, { id: uid(), ref: '', fn: '', agg: '', as: '', show: true }])}><IconPlus width={12} height={12} /> Column</button>
                      <button className="btn btn-sm" disabled={!nodes.length} onClick={() => setOuts((l) => [...l, { id: uid(), ref: 'expr', expr: '', fn: '', agg: '', as: 'calc', show: true }])}><IconPlus width={12} height={12} /> Calculated column</button>
                      <button className="btn btn-sm" disabled={!nodes.length} onClick={() => setOuts((l) => [...l, { id: uid(), ref: 'rows', expr: '*', fn: '', agg: 'COUNT', as: 'row_count', show: true }])}><IconPlus width={12} height={12} /> Row count</button>
                      {outs.some((o) => o.agg) && <span className="muted small-text">Columns without an aggregate are grouped (GROUP BY).</span>}
                    </div>
                  </>
                )}

                {tab === 'joins' && (
                  <>
                    {joins.length === 0 && <p className="muted small-text">{nodes.length > 1 ? 'No joins: the tables are combined row by row (CROSS JOIN). Drag a column onto another table to join.' : 'Add a second table to join.'}</p>}
                    {joins.map((j) => (
                      <div key={j.id} className={`qb-row qb-join-row ${selJoin === j.id ? 'on' : ''}`} onClick={() => setSelJoin(j.id)}>
                        {colSelect(j.left && `${j.left}.${j.leftCol}`, (v) => { const [a, ...c] = v.split('.'); patch(setJoins, j.id, { left: a, leftCol: c.join('.'), auto: false }) })}
                        <div className="seg qb-seg">
                          {(Object.keys(JOIN_LABEL) as JoinType[]).map((t) => <button key={t} className={j.type === t ? 'on' : ''} onClick={() => patch(setJoins, j.id, { type: t })}
                            title={t === 'INNER' ? 'Only rows that match on both sides' : t === 'LEFT' ? 'All rows of the left table' : t === 'RIGHT' ? 'All rows of the right table' : 'All rows of both tables'}>{JOIN_LABEL[t]}</button>)}
                        </div>
                        {colSelect(j.right && `${j.right}.${j.rightCol}`, (v) => { const [a, ...c] = v.split('.'); patch(setJoins, j.id, { right: a, rightCol: c.join('.'), auto: false }) })}
                        {j.auto && <span className="qb-chip">foreign key</span>}
                        <button className="icon-btn" onClick={() => setJoins((l) => l.filter((x) => x.id !== j.id))} title="Remove join"><IconTrash width={13} height={13} /></button>
                      </div>
                    ))}
                    {nodes.length > 1 && <button className="btn btn-sm" onClick={() => setJoins((l) => [...l, { id: uid(), type: 'INNER', left: nodes[0].alias, leftCol: '', right: nodes[nodes.length - 1].alias, rightCol: '' }])}><IconPlus width={12} height={12} /> Join condition</button>}
                  </>
                )}

                {tab === 'filters' && (
                  <>
                    {filters.length === 0 && <p className="muted small-text">No filters: every row is returned. Values starting with “=” are used as SQL (e.g. <code>=CURRENT_DATE</code>).</p>}
                    {filters.map((f, i) => (
                      <div key={f.id} className="qb-row">
                        {i === 0 ? <span className="qb-conj muted">Where</span> : (
                          <select className="qb-conj" value={f.conj} onChange={(e) => patch(setFilters, f.id, { conj: e.target.value as Filter['conj'] })}><option>AND</option><option>OR</option></select>
                        )}
                        <select value={f.agg} onChange={(e) => patch(setFilters, f.id, { agg: e.target.value as Agg })} title="Filter on an aggregate (HAVING)">
                          {AGGS.map((a) => <option key={a} value={a}>{a || 'value of'}</option>)}
                        </select>
                        {colSelect(f.col, (v) => patch(setFilters, f.id, { col: v }))}
                        <select value={f.op} onChange={(e) => patch(setFilters, f.id, { op: e.target.value })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
                        {!f.op.startsWith('IS') && <input value={f.value} onChange={(e) => patch(setFilters, f.id, { value: e.target.value })} placeholder={f.op.includes('IN') ? 'a, b, c' : f.op.includes('LIKE') ? '%text%' : 'value'} />}
                        {f.op === 'BETWEEN' && <><span className="muted">and</span><input value={f.value2} onChange={(e) => patch(setFilters, f.id, { value2: e.target.value })} placeholder="value" /></>}
                        {f.agg && <span className="qb-chip">HAVING</span>}
                        <button className="icon-btn" onClick={() => setFilters((l) => l.filter((x) => x.id !== f.id))} title="Remove filter"><IconTrash width={13} height={13} /></button>
                      </div>
                    ))}
                    <button className="btn btn-sm" disabled={!nodes.length} onClick={() => setFilters((l) => [...l, { id: uid(), conj: 'AND', col: '', agg: '', op: '=', value: '', value2: '' }])}><IconPlus width={12} height={12} /> Filter</button>
                    {filters.some((f) => f.conj === 'OR') && <p className="muted small-text">AND is checked before OR. For other groupings, open the SQL in a query tab and add brackets.</p>}
                  </>
                )}

                {tab === 'sort' && (
                  <>
                    {sorts.length === 0 && <p className="muted small-text">No sort: the database returns rows in any order.</p>}
                    {sorts.map((s, i) => (
                      <div key={s.id} className="qb-row">
                        <span className="qb-conj muted">{i ? 'then' : 'Sort by'}</span>
                        {colSelect(s.col, (v) => patch(setSorts, s.id, { col: v }), outNames)}
                        <div className="seg qb-seg">
                          <button className={s.dir === 'ASC' ? 'on' : ''} onClick={() => patch(setSorts, s.id, { dir: 'ASC' })}>A → Z / 1 → 9</button>
                          <button className={s.dir === 'DESC' ? 'on' : ''} onClick={() => patch(setSorts, s.id, { dir: 'DESC' })}>Z → A / 9 → 1</button>
                        </div>
                        <button className="icon-btn" disabled={!i} onClick={() => move(setSorts, i, -1)} title="Move up"><IconArrowUp width={11} height={11} /></button>
                        <button className="icon-btn" disabled={i === sorts.length - 1} onClick={() => move(setSorts, i, 1)} title="Move down"><IconArrowDown width={11} height={11} /></button>
                        <button className="icon-btn" onClick={() => setSorts((l) => l.filter((x) => x.id !== s.id))} title="Remove"><IconTrash width={13} height={13} /></button>
                      </div>
                    ))}
                    <button className="btn btn-sm" disabled={!nodes.length} onClick={() => setSorts((l) => [...l, { id: uid(), col: '', dir: 'ASC' }])}><IconPlus width={12} height={12} /> Sort</button>
                  </>
                )}

                {tab === 'options' && (
                  <div className="qb-options">
                    <label className="field"><span>Rows to return</span><input type="number" min={0} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 0)} /><small className="muted">0 = all rows</small></label>
                    <label className="field"><span>Skip first rows</span><input type="number" min={0} value={offset} onChange={(e) => setOffset(Number(e.target.value) || 0)} /><small className="muted">For paging (OFFSET)</small></label>
                    <div className="field"><span>Paging</span>
                      <div className="qb-row">
                        <button className="btn btn-sm" disabled={!offset || !limit} onClick={() => setOffset(Math.max(0, offset - limit))}>← Previous page</button>
                        <button className="btn btn-sm" disabled={!limit} onClick={() => setOffset(offset + limit)}>Next page →</button>
                      </div>
                    </div>
                    <label className="check"><input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} /> Remove duplicate rows (DISTINCT)</label>
                  </div>
                )}
              </div>
            </div>
            {error && <div className="notice error qb-error">{error}<button className="icon-btn" onClick={() => setError('')}><IconX width={12} height={12} /></button></div>}
          </div>

          <div className="qb-preview">
            <div className="qb-sql">
              <div className="qb-pane-head">SQL <span className="spacer" />
                <button className="icon-btn" disabled={!sql} title="Copy SQL" onClick={() => { navigator.clipboard.writeText(sql); onStatus('SQL copied') }}><IconCopy width={13} height={13} /></button>
              </div>
              <CodeMirror value={sql || '-- The SQL appears here as you build'} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={[sqlLang()]} editable={false} basicSetup={{ foldGutter: false, lineNumbers: false }} />
            </div>
            <div className="qb-result">
              {result ? <ResultView result={result} name="Built query" onStatus={onStatus} /> : <div className="placeholder">Press Run (Ctrl+Enter) to see the rows.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
