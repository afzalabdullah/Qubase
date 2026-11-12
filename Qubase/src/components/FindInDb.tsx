import { useEffect, useRef, useState } from 'react'
import type { ColumnInfo, QueryResult, TableInfo } from '../../shared/types'
import { quote, sqlLiteral, tableRef } from '../../shared/ddl'
import { ResultView } from './ResultView'
import { IconSearch, IconStop, IconTable } from './Icons'
import { errMsg } from '../util'
import { useConn } from '../settings'

interface Hit { table: TableInfo; columns: string[]; where: string; result: QueryResult }

const TEXT = /char|text|string|clob|json|uuid|xml|enum|name|citext|nvarchar|varchar/i
const NUM = /int|num|dec|float|double|real|money|serial|bit/i
const PER_TABLE = 100

/**
 * Search for a value in every table: text columns with "contains" (or exact),
 * number columns when the value is a number. One query per table, up to 100 rows each.
 */
export function FindInDb({ onOpenTable, onStatus }: { onOpenTable: (t: TableInfo, view?: 'data', where?: string) => void; onStatus: (s: string) => void }) {
  const { connId, engine } = useConn()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [term, setTerm] = useState('')
  const [exact, setExact] = useState(false)
  const [views, setViews] = useState(false)
  const [only, setOnly] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; table: string } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const stop = useRef(false)

  useEffect(() => { window.db.listTables(connId).then(setTables).catch((e) => setErrors([errMsg(e)])) }, [connId])

  const q = (c: string) => quote(engine, c)
  /** One column's condition; null when the column can't hold the value */
  const cond = (c: ColumnInfo, v: string): string | null => {
    const isNum = /^-?\d+(\.\d+)?$/.test(v)
    if (NUM.test(c.dataType) && !TEXT.test(c.dataType)) return isNum ? `${q(c.name)} = ${v}` : null
    if (!TEXT.test(c.dataType) && c.dataType) return null
    if (exact) return `${q(c.name)} = ${sqlLiteral(v)}`
    const pattern = sqlLiteral(`%${v.replace(/[%_]/g, (m) => (engine === 'mysql' ? '\\' : '!') + m)}%`)
    const esc = engine === 'mysql' ? '' : ` ESCAPE '!'`
    if (engine === 'postgres') return `CAST(${q(c.name)} AS TEXT) ILIKE ${pattern}${esc}`
    if (engine === 'oracle') return `UPPER(${q(c.name)}) LIKE UPPER(${pattern})${esc}`
    if (engine === 'mssql' && /^(n?text|xml)$/i.test(c.dataType)) return `CAST(${q(c.name)} AS NVARCHAR(MAX)) LIKE ${pattern}${esc}`
    if (engine === 'duckdb' || engine === 'clickhouse') return `CAST(${q(c.name)} AS VARCHAR) ILIKE ${pattern}${esc}`
    return `${q(c.name)} LIKE ${pattern}${esc}`
  }
  const limitSql = (ref: string, where: string) =>
    engine === 'mssql' ? `SELECT TOP ${PER_TABLE} * FROM ${ref} WHERE ${where}`
      : engine === 'oracle' ? `SELECT * FROM ${ref} WHERE ${where} FETCH FIRST ${PER_TABLE} ROWS ONLY`
        : `SELECT * FROM ${ref} WHERE ${where} LIMIT ${PER_TABLE}`

  const search = async () => {
    const v = term.trim()
    if (!v) return
    stop.current = false
    setHits([]); setErrors([]); setOpen(null)
    const want = tables.filter((t) => (views || t.type !== 'view') && (!only || `${t.schema ?? ''}.${t.name}`.toLowerCase().includes(only.toLowerCase())))
    const found: Hit[] = []
    const errs: string[] = []
    for (let i = 0; i < want.length; i++) {
      if (stop.current) break
      const t = want[i]
      setProgress({ done: i, total: want.length, table: t.name })
      try {
        const cols = await window.db.listColumns(connId, t)
        const parts = cols.map((c) => ({ c, s: cond(c, v) })).filter((x): x is { c: ColumnInfo; s: string } => !!x.s)
        if (!parts.length) continue
        const where = parts.map((x) => x.s).join(' OR ')
        const [r] = await window.db.queryMulti(connId, limitSql(tableRef(engine, t), where), PER_TABLE)
        if (r.rows.length) {
          // Which columns matched in the returned rows
          const lower = v.toLowerCase()
          const matched = parts.map((x) => x.c.name).filter((c) => r.rows.some((row) => {
            const cell = row[c]
            return cell !== null && cell !== undefined && (exact ? String(cell) === v : String(cell).toLowerCase().includes(lower))
          }))
          found.push({ table: t, columns: matched, where, result: r })
          setHits([...found])
        }
      } catch (e) { errs.push(`${t.name}: ${errMsg(e)}`) }
    }
    setErrors(errs)
    setProgress(null)
    const rows = found.reduce((n, h) => n + h.result.rows.length, 0)
    onStatus(`${stop.current ? 'Stopped · ' : ''}Found in ${found.length} table${found.length === 1 ? '' : 's'} · ${rows} rows`)
  }

  return (
    <div className="find-db">
      <form className="toolbar wrap" onSubmit={(e) => { e.preventDefault(); search() }}>
        <strong>Find in database</strong>
        <div className="result-filter find-input"><IconSearch className="search-icon" /><input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Value to find, e.g. an email or an order number" /></div>
        <label className="check small-text"><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> Exact match</label>
        <label className="check small-text"><input type="checkbox" checked={views} onChange={(e) => setViews(e.target.checked)} /> Include views</label>
        <input className="small-input" value={only} onChange={(e) => setOnly(e.target.value)} placeholder="Only tables named…" />
        {progress
          ? <button type="button" className="btn btn-sm" onClick={() => { stop.current = true }}><IconStop width={12} height={12} /> Stop</button>
          : <button className="btn btn-sm btn-primary" disabled={!term.trim()}>Search</button>}
        {progress && <span className="muted small-text">Searching {progress.done + 1} / {progress.total}: {progress.table}</span>}
      </form>
      <div className="find-body">
        {!hits.length && !progress && <div className="placeholder">{term && errors.length === 0 ? 'Type a value and press Search. Text columns are searched with “contains”, number columns when the value is a number.' : 'Type a value and press Search.'}</div>}
        {hits.map((h, i) => (
          <div key={`${h.table.schema}.${h.table.name}`} className={`find-hit ${open === i ? 'open' : ''}`}>
            <div className="find-head" onClick={() => setOpen(open === i ? null : i)}>
              <IconTable width={14} height={14} />
              <strong>{h.table.schema ? `${h.table.schema}.` : ''}{h.table.name}</strong>
              <span className="badge">{h.result.rows.length}{h.result.rows.length >= PER_TABLE ? '+' : ''}</span>
              <span className="muted small-text">in {h.columns.join(', ') || 'matching columns'}</span>
              <div className="spacer" />
              <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onOpenTable(h.table, 'data', h.where) }} title="Open the table filtered to these rows">Open filtered</button>
            </div>
            {open === i && <div className="find-rows"><ResultView result={h.result} name={`${h.table.name} matches`} onStatus={onStatus} /></div>}
          </div>
        ))}
        {errors.length > 0 && <details className="find-errors"><summary>{errors.length} table{errors.length === 1 ? '' : 's'} could not be searched</summary><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
      </div>
    </div>
  )
}
