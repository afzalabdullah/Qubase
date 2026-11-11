import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang } from '@codemirror/lang-sql'
import type { QueryResult, TableInfo, TableStructure } from '../../shared/types'
import { quote, sqlLiteral, tableRef } from '../../shared/ddl'
import { ResultView } from './ResultView'
import { IconCode, IconPlay, IconPlus, IconSearch, IconTrash, IconX } from './Icons'
import { errMsg } from '../util'
import { readSettings, useConn } from '../settings'
import { editorTheme } from '../editorThemes'
import { formatSqlText } from '../format'

type Agg = '' | 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
interface Picked { alias: string; table: TableInfo; structure: TableStructure; columns: Record<string, Agg | 'on' | undefined> }
interface Join { id: string; type: 'INNER' | 'LEFT'; left: string; leftCol: string; right: string; rightCol: string; auto?: boolean }
interface Filter { id: string; col: string; op: string; value: string }
interface Sort { col: string; dir: 'ASC' | 'DESC' }

const RESERVED = new Set(['as', 'at', 'by', 'do', 'go', 'if', 'in', 'is', 'no', 'of', 'on', 'or', 'to', 'up', 'all', 'and', 'any', 'asc', 'end', 'for', 'key', 'not', 'set', 'top', 'use'])
const OPS = ['=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'IS NULL', 'IS NOT NULL']
const label = (t: TableInfo) => (t.schema ? `${t.schema}.${t.name}` : t.name)
const uid = () => crypto.randomUUID()

/** Build a SELECT by clicking: tables, columns, joins (found from foreign keys), filters, sorting. */
export function QueryBuilder({ dark, onOpenQuery, onStatus }: { dark: boolean; onOpenQuery: (title: string, text: string) => void; onStatus: (s: string) => void }) {
  const { connId, engine } = useConn()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Picked[]>([])
  const [joins, setJoins] = useState<Join[]>([])
  const [filters, setFilters] = useState<Filter[]>([])
  const [sorts, setSorts] = useState<Sort[]>([])
  const [limit, setLimit] = useState(100)
  const [distinct, setDistinct] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { window.db.listTables(connId).then(setTables).catch((e) => setError(errMsg(e))) }, [connId])

  const q = (n: string) => quote(engine, n)
  const allCols = picked.flatMap((p) => p.structure.columns.map((c) => `${p.alias}.${c.name}`))

  const addTable = async (t: TableInfo) => {
    setError('')
    try {
      const structure = await window.db.getStructure(connId, t)
      const list = picked
      const base = t.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toLowerCase() || 't'
      // Short aliases like "or" or "as" are SQL keywords, so those get a number
      let alias = RESERVED.has(base) ? `${base}1` : base, n = 2
      while (list.some((p) => p.alias === alias)) alias = `${base}${n++}`
      // Join it to a table already picked, using a foreign key in either direction
      const same = (a: { schema?: string; name: string }, b: { refSchema?: string; refTable: string }) =>
        a.name.toLowerCase() === b.refTable.toLowerCase() && (!b.refSchema || !a.schema || a.schema.toLowerCase() === b.refSchema.toLowerCase())
      const found: Join[] = []
      for (const o of list) {
        for (const fk of structure.foreignKeys) if (same(o.table, fk)) found.push({ id: uid(), type: 'INNER', left: o.alias, leftCol: fk.refColumns[0], right: alias, rightCol: fk.columns[0], auto: true })
        for (const fk of o.structure.foreignKeys) if (same(t, fk)) found.push({ id: uid(), type: 'INNER', left: o.alias, leftCol: fk.columns[0], right: alias, rightCol: fk.refColumns[0], auto: true })
      }
      if (found.length) setJoins((j) => [...j, found[0]])
      else if (list.length) setJoins((j) => [...j, { id: uid(), type: 'INNER', left: list[0].alias, leftCol: list[0].structure.columns[0]?.name ?? '', right: alias, rightCol: structure.columns[0]?.name ?? '' }])
      setPicked([...list, { alias, table: t, structure, columns: {} }])
    } catch (e) { setError(errMsg(e)) }
  }

  const removeTable = (alias: string) => {
    setPicked((l) => l.filter((p) => p.alias !== alias))
    setJoins((j) => j.filter((x) => x.left !== alias && x.right !== alias))
    setFilters((f) => f.filter((x) => !x.col.startsWith(alias + '.')))
    setSorts((s) => s.filter((x) => !x.col.startsWith(alias + '.')))
  }

  const toggleCol = (alias: string, col: string, v: Agg | 'on' | undefined) =>
    setPicked((l) => l.map((p) => (p.alias === alias ? { ...p, columns: { ...p.columns, [col]: v } } : p)))

  const sql = useMemo(() => {
    if (!picked.length) return ''
    const ref = (c: string) => { const [a, ...rest] = c.split('.'); return `${a}.${q(rest.join('.'))}` }
    const sel: string[] = [], groupBy: string[] = []
    let anyAgg = false
    for (const p of picked) for (const c of p.structure.columns) {
      const v = p.columns[c.name]
      if (!v) continue
      const r = `${p.alias}.${q(c.name)}`
      if (v === 'on') { sel.push(r); groupBy.push(r) } else { anyAgg = true; sel.push(`${v}(${r}) AS ${q(`${v.toLowerCase()}_${c.name}`)}`) }
    }
    if (!sel.length) sel.push(picked.length === 1 ? '*' : picked.map((p) => `${p.alias}.*`).join(', '))
    const from = [`${tableRef(engine, picked[0].table)} ${picked[0].alias}`]
    const joined = new Set([picked[0].alias])
    for (const p of picked.slice(1)) {
      const js = joins.filter((j) => j.right === p.alias || j.left === p.alias)
      const conds = js.filter((j) => joined.has(j.left === p.alias ? j.right : j.left)).map((j) => `${j.left}.${q(j.leftCol)} = ${j.right}.${q(j.rightCol)}`)
      const type = js.find((j) => j.right === p.alias)?.type ?? 'INNER'
      from.push(conds.length ? `${type} JOIN ${tableRef(engine, p.table)} ${p.alias} ON ${conds.join(' AND ')}` : `CROSS JOIN ${tableRef(engine, p.table)} ${p.alias}`)
      joined.add(p.alias)
    }
    const value = (v: string) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : sqlLiteral(v))
    const where = filters.filter((f) => f.col).map((f) => {
      if (f.op.startsWith('IS')) return `${ref(f.col)} ${f.op}`
      if (f.op === 'IN') return `${ref(f.col)} IN (${f.value.split(',').map((x) => value(x.trim())).join(', ')})`
      return `${ref(f.col)} ${f.op} ${value(f.value)}`
    })
    const order = sorts.filter((s) => s.col).map((s) => `${ref(s.col)} ${s.dir}`)
    const n = Math.max(0, Math.floor(limit))
    const top = n && engine === 'mssql' ? `TOP ${n} ` : ''
    let text = `SELECT ${distinct ? 'DISTINCT ' : ''}${top}${sel.join(', ')}\nFROM ${from.join('\n')}`
    if (where.length) text += `\nWHERE ${where.join('\n  AND ')}`
    if (anyAgg && groupBy.length) text += `\nGROUP BY ${groupBy.join(', ')}`
    if (order.length) text += `\nORDER BY ${order.join(', ')}`
    if (n && engine === 'oracle') text += `\nFETCH FIRST ${n} ROWS ONLY`
    else if (n && engine !== 'mssql') text += `\nLIMIT ${n}`
    try { return formatSqlText(text, engine) } catch { return text }
  }, [picked, joins, filters, sorts, limit, distinct, engine]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!sql) return
    setBusy(true); setError('')
    try {
      const [r] = await window.db.queryMulti(connId, sql, 10000)
      setResult(r)
      onStatus(`${r.rowCount.toLocaleString()} rows · ${r.durationMs} ms`)
    } catch (e) { setError(errMsg(e)); setResult(null) } finally { setBusy(false) }
  }

  const shown = tables.filter((t) => label(t).toLowerCase().includes(search.toLowerCase())).slice(0, 300)
  const colSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">column…</option>
      {allCols.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  )

  return (
    <div className="qb">
      <aside className="qb-tables">
        <div className="qb-search"><IconSearch width={13} height={13} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a table" /></div>
        <div className="qb-table-list">
          {shown.map((t) => (
            <button key={label(t)} onClick={() => addTable(t)} title="Add to the query">
              <IconPlus width={11} height={11} /> {label(t)}{t.type === 'view' ? <span className="muted small-text"> view</span> : null}
            </button>
          ))}
        </div>
      </aside>
      <div className="qb-main">
        <div className="toolbar">
          <strong>Query builder</strong>
          <span className="muted small-text">Click tables on the left; tick columns; joins come from foreign keys.</span>
          <div className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={run} disabled={!sql || busy}><IconPlay width={12} height={12} /> {busy ? 'Running…' : 'Run'}</button>
          <button className="btn btn-sm" disabled={!sql} onClick={() => onOpenQuery('Built query', sql)}><IconCode width={13} height={13} /> Open in query tab</button>
          <button className="btn btn-sm" disabled={!picked.length} onClick={() => { setPicked([]); setJoins([]); setFilters([]); setSorts([]); setResult(null) }}>Clear</button>
        </div>
        <div className="qb-body">
          <div className="qb-design">
            {!picked.length && <div className="placeholder">Pick a table on the left to start.</div>}
            <div className="qb-cards">
              {picked.map((p) => (
                <div key={p.alias} className="qb-card">
                  <div className="qb-card-head"><strong>{label(p.table)}</strong> <span className="muted">{p.alias}</span>
                    <div className="spacer" /><button className="icon-btn" title="Remove" onClick={() => removeTable(p.alias)}><IconX width={12} height={12} /></button></div>
                  <div className="qb-cols">
                    {p.structure.columns.map((c) => (
                      <div key={c.name} className="qb-col">
                        <input type="checkbox" checked={!!p.columns[c.name]} onChange={(e) => toggleCol(p.alias, c.name, e.target.checked ? 'on' : undefined)} />
                        <span className="grow" title={c.dataType}>{c.primaryKey ? '🔑 ' : ''}{c.name}</span>
                        {p.columns[c.name] && (
                          <select className="qb-agg" value={p.columns[c.name] === 'on' ? '' : p.columns[c.name]} onChange={(e) => toggleCol(p.alias, c.name, (e.target.value || 'on') as Agg)} title="Aggregate">
                            {['', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].map((a) => <option key={a} value={a}>{a || 'value'}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {picked.length > 1 && (
              <section className="qb-section">
                <h4>Joins</h4>
                {joins.map((j) => (
                  <div key={j.id} className="qb-row">
                    <select value={j.type} onChange={(e) => setJoins((l) => l.map((x) => (x.id === j.id ? { ...x, type: e.target.value as Join['type'] } : x)))}>
                      <option value="INNER">INNER JOIN</option><option value="LEFT">LEFT JOIN</option>
                    </select>
                    {colSelect(`${j.left}.${j.leftCol}`, (v) => { const [a, ...c] = v.split('.'); setJoins((l) => l.map((x) => (x.id === j.id ? { ...x, left: a, leftCol: c.join('.'), auto: false } : x))) })}
                    <span>=</span>
                    {colSelect(`${j.right}.${j.rightCol}`, (v) => { const [a, ...c] = v.split('.'); setJoins((l) => l.map((x) => (x.id === j.id ? { ...x, right: a, rightCol: c.join('.'), auto: false } : x))) })}
                    {j.auto && <span className="muted small-text">from foreign key</span>}
                    <button className="icon-btn" onClick={() => setJoins((l) => l.filter((x) => x.id !== j.id))}><IconTrash width={13} height={13} /></button>
                  </div>
                ))}
                <button className="btn btn-sm" onClick={() => setJoins((l) => [...l, { id: uid(), type: 'INNER', left: picked[0].alias, leftCol: '', right: picked[picked.length - 1].alias, rightCol: '' }])}><IconPlus width={12} height={12} /> Join condition</button>
              </section>
            )}
            {picked.length > 0 && (
              <>
                <section className="qb-section">
                  <h4>Filters <span className="muted small-text">(all must match)</span></h4>
                  {filters.map((f) => (
                    <div key={f.id} className="qb-row">
                      {colSelect(f.col, (v) => setFilters((l) => l.map((x) => (x.id === f.id ? { ...x, col: v } : x))))}
                      <select value={f.op} onChange={(e) => setFilters((l) => l.map((x) => (x.id === f.id ? { ...x, op: e.target.value } : x)))}>
                        {OPS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                      {!f.op.startsWith('IS') && <input value={f.value} onChange={(e) => setFilters((l) => l.map((x) => (x.id === f.id ? { ...x, value: e.target.value } : x)))} placeholder={f.op === 'IN' ? 'a, b, c' : f.op.includes('LIKE') ? '%text%' : 'value'} />}
                      <button className="icon-btn" onClick={() => setFilters((l) => l.filter((x) => x.id !== f.id))}><IconTrash width={13} height={13} /></button>
                    </div>
                  ))}
                  <button className="btn btn-sm" onClick={() => setFilters((l) => [...l, { id: uid(), col: '', op: '=', value: '' }])}><IconPlus width={12} height={12} /> Filter</button>
                </section>
                <section className="qb-section">
                  <h4>Sort and limit</h4>
                  {sorts.map((s, i) => (
                    <div key={i} className="qb-row">
                      {colSelect(s.col, (v) => setSorts((l) => l.map((x, k) => (k === i ? { ...x, col: v } : x))))}
                      <select value={s.dir} onChange={(e) => setSorts((l) => l.map((x, k) => (k === i ? { ...x, dir: e.target.value as Sort['dir'] } : x)))}>
                        <option value="ASC">A → Z</option><option value="DESC">Z → A</option>
                      </select>
                      <button className="icon-btn" onClick={() => setSorts((l) => l.filter((_, k) => k !== i))}><IconTrash width={13} height={13} /></button>
                    </div>
                  ))}
                  <div className="qb-row">
                    <button className="btn btn-sm" onClick={() => setSorts((l) => [...l, { col: '', dir: 'ASC' }])}><IconPlus width={12} height={12} /> Sort</button>
                    <label className="check small-text"><input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} /> Distinct rows</label>
                    <label className="small-text">Limit <input type="number" min={0} className="small-input narrow" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 0)} /></label>
                    <span className="muted small-text">0 = no limit</span>
                  </div>
                </section>
              </>
            )}
            {error && <div className="notice error">{error}</div>}
          </div>
          <div className="qb-preview">
            <div className="qb-sql">
              <CodeMirror value={sql || '-- The SQL appears here'} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={[sqlLang()]} editable={false} basicSetup={{ foldGutter: false, lineNumbers: false }} />
            </div>
            <div className="qb-result">
              {result ? <ResultView result={result} name="Built query" onStatus={onStatus} /> : <div className="placeholder">Press Run to see the rows.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
