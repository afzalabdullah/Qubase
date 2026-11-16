import { useEffect, useRef, useState } from 'react'
import type { ColumnInfo, TableInfo } from '../../shared/types'
import { quote, tableRef } from '../../shared/ddl'
import { cellText, errMsg } from '../util'
import { IconStop } from './Icons'

// Data profiling: per column, how full it is, how many distinct values, the range and the most common values,
// plus duplicate rows for the whole table. Runs one small query per column so it can be stopped.

export interface ColumnProfile {
  column: ColumnInfo
  filled?: number
  distinct?: number
  min?: unknown
  max?: unknown
  top?: { value: unknown; n: number }[]
  error?: string
}

/** A query limited to n rows in the engine's own syntax */
export function limitSql(engine: string, sql: string, n: number) {
  if (engine === 'mssql') return sql.replace(/^SELECT\b/i, `SELECT TOP ${n}`)
  if (engine === 'oracle') return `${sql} FETCH FIRST ${n} ROWS ONLY`
  return `${sql} LIMIT ${n}`
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
/** Values of the first row, by position (column aliases come back in different cases per engine) */
const first = (r: { columns: string[]; rows: Record<string, unknown>[] }) => r.columns.map((c) => r.rows[0]?.[c])
const NO_MINMAX = /json|xml|blob|bytea|binary|image|geometry|geography|array|map|struct|variant|object|text\[\]/i

export function ProfileView({ connId, engine, table }: { connId: string; engine: string; table: TableInfo }) {
  const [total, setTotal] = useState<number | null>(null)
  const [dupes, setDupes] = useState<number | null | 'error'>(null)
  const [cols, setCols] = useState<ColumnProfile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const stop = useRef(false)
  const ref = tableRef(engine, table)
  const q = (c: string) => quote(engine, c)

  const run = async () => {
    stop.current = false
    setBusy(true); setError(''); setTotal(null); setDupes(null)
    try {
      const columns = await window.db.listColumns(connId, table)
      setCols(columns.map((column) => ({ column })))
      const n = num(first(await window.db.query(connId, `SELECT COUNT(*) AS n FROM ${ref}`))[0])
      setTotal(n)
      for (let i = 0; i < columns.length && !stop.current; i++) {
        const c = columns[i], col = q(c.name)
        const p: ColumnProfile = { column: c }
        try {
          const minmax = NO_MINMAX.test(c.dataType) ? '' : `, MIN(${col}) AS lo, MAX(${col}) AS hi`
          const r = first(await window.db.query(connId, `SELECT COUNT(${col}) AS filled, COUNT(DISTINCT ${col}) AS dist${minmax} FROM ${ref}`))
          Object.assign(p, { filled: num(r[0]), distinct: num(r[1]), min: r[2], max: r[3] })
          const t = await window.db.query(connId, limitSql(engine, `SELECT ${col} AS v, COUNT(*) AS n FROM ${ref} GROUP BY ${col} ORDER BY COUNT(*) DESC`, 5))
          p.top = t.rows.map((row) => { const [v, k] = t.columns.map((x) => row[x]); return { value: v, n: num(k) } })
        } catch (e) { p.error = errMsg(e) }
        setCols((list) => list.map((x, k) => (k === i ? p : x)))
      }
      if (!stop.current && columns.length) {
        const all = columns.filter((c) => !NO_MINMAX.test(c.dataType)).map((c) => q(c.name)).join(', ')
        try {
          const d = await window.db.query(connId, `SELECT COUNT(*) AS n, SUM(k) AS extra FROM (SELECT COUNT(*) - 1 AS k FROM ${ref} GROUP BY ${all} HAVING COUNT(*) > 1) d`)
          setDupes(num(first(d)[1]))
        } catch { setDupes('error') }
      }
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }
  useEffect(() => { run(); return () => { stop.current = true } }, [connId, table.schema, table.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (x?: number) => (total ? Math.round(((x ?? 0) / total) * 1000) / 10 : 0)
  const show = (v: unknown) => (v === null || v === undefined ? '—' : cellText(v).slice(0, 40))

  return (
    <div className="profile-view">
      <div className="profile-head">
        <strong>{total === null ? 'Counting rows…' : `${total.toLocaleString()} rows`}</strong>
        <span className="muted small-text">
          {dupes === null ? (busy ? ' · profiling…' : '') : dupes === 'error' ? ' · duplicates could not be checked' : dupes ? ` · ${dupes.toLocaleString()} duplicate rows` : ' · no duplicate rows'}
        </span>
        <div className="spacer" />
        {busy
          ? <button className="btn btn-sm" onClick={() => { stop.current = true }}><IconStop width={12} height={12} /> Stop</button>
          : <button className="btn btn-sm" onClick={run}>Profile again</button>}
      </div>
      {error && <div className="notice error">{error}</div>}
      {total !== null && total > 5_000_000 && <p className="muted small-text">Large table: each column scans all rows, so this can take a while.</p>}
      <div className="profile-table-wrap">
        <table className="profile-table">
          <thead><tr><th>Column</th><th>Type</th><th>Filled</th><th>Distinct</th><th>Min</th><th>Max</th><th>Most common values</th></tr></thead>
          <tbody>
            {cols.map((p) => (
              <tr key={p.column.name}>
                <td><strong>{p.column.name}</strong>{p.column.primaryKey && <span className="muted"> · key</span>}</td>
                <td className="muted">{p.column.dataType}</td>
                {p.error ? <td colSpan={5} className="err-text small-text">{p.error}</td> : p.filled === undefined ? <td colSpan={5} className="muted">…</td> : <>
                  <td>
                    <div className="profile-bar" title={`${(total ?? 0) - p.filled} empty (NULL)`}><span style={{ width: `${pct(p.filled)}%` }} /></div>
                    <span className="small-text">{pct(p.filled)}%{p.filled < (total ?? 0) ? <span className="muted"> · {((total ?? 0) - p.filled).toLocaleString()} empty</span> : null}</span>
                  </td>
                  <td>{p.distinct?.toLocaleString()}{p.distinct === total && total ? <span className="muted small-text"> · unique</span> : null}</td>
                  <td className="mono small-text">{show(p.min)}</td>
                  <td className="mono small-text">{show(p.max)}</td>
                  <td className="small-text">
                    {(p.top ?? []).map((t, k) => (
                      <div key={k} className="profile-top">
                        <span className="profile-top-bar" style={{ width: `${Math.max(2, pct(t.n))}%` }} />
                        <span className="mono">{t.value === null || t.value === undefined ? <span className="muted">NULL</span> : show(t.value)}</span>
                        <span className="muted"> {t.n.toLocaleString()}</span>
                      </div>
                    ))}
                  </td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
