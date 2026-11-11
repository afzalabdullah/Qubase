import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang } from '@codemirror/lang-sql'
import type { SavedConnection, TableInfo } from '../../shared/types'
import { quote, sqlLiteral, tableRef } from '../../shared/ddl'
import { driverFor } from '../../shared/drivers'
import { IconCopy } from './Icons'
import { Combo, useTargetCatalog } from './Combo'
import { errMsg } from '../util'
import { allowRun, checkSql } from '../safety'
import { readSettings, useConn } from '../settings'
import { editorTheme } from '../editorThemes'

/** Rows read from each side; bigger tables are compared on their first rows only */
const MAX_ROWS = 100000

type Row = Record<string, unknown>
type Status = 'changed' | 'source' | 'target'
interface DiffRow { key: string; status: Status; src?: Row; dst?: Row; cols: string[] }

const label = (t: TableInfo) => (t.schema ? `${t.schema}.${t.name}` : t.name)
const tKey = (t: TableInfo) => `${t.schema ?? ''}.${t.name}`

/** Values compared as text, so 1 and "1" or two equal dates match */
function norm(v: unknown): string {
  if (v === null || v === undefined) return '\u0000NULL'
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return String(v)
}

/**
 * Compare the rows of one table here with a table on another (or the same)
 * connection, matched by key columns, and build the script that makes the
 * target rows match.
 */
export function DataCompare({ dark, onStatus }: { dark: boolean; onStatus: (s: string) => void }) {
  const { conn, connId, engine } = useConn()
  const [saved, setSaved] = useState<SavedConnection[]>([])
  const [srcTables, setSrcTables] = useState<TableInfo[]>([])
  const [srcTable, setSrcTable] = useState('')
  const [targetId, setTargetId] = useState('self')
  const [targetDb, setTargetDb] = useState('')
  const [targetTable, setTargetTable] = useState('')
  const [keyCols, setKeyCols] = useState<string[]>([])
  const [allCols, setAllCols] = useState<string[]>([])
  const [diffs, setDiffs] = useState<DiffRow[] | null>(null)
  const [summary, setSummary] = useState<{ same: number; changed: number; source: number; target: number; capped: boolean } | null>(null)
  const [show, setShow] = useState<Status | 'all'>('all')
  const [withDeletes, setWithDeletes] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.db.listTables(connId).then((l) => setSrcTables(l.filter((t) => t.type !== 'view'))).catch((e) => setError(errMsg(e)))
    window.db.listSaved().then((l) => setSaved(l.filter((c) => c.id !== conn.id && driverFor(c.config.kind).engine === engine))).catch(() => {})
  }, [connId, engine, conn.id])

  const source = srcTables.find((t) => tKey(t) === srcTable)

  // Key columns default to the primary key
  useEffect(() => {
    if (!source) return
    setDiffs(null); setSummary(null)
    window.db.getStructure(connId, source).then((s) => {
      setAllCols(s.columns.map((c) => c.name))
      const pk = s.columns.filter((c) => c.primaryKey).map((c) => c.name)
      setKeyCols(pk.length ? pk : s.columns.slice(0, 1).map((c) => c.name))
    }).catch((e) => setError(errMsg(e)))
    setTargetTable(label(source))
  }, [srcTable]) // eslint-disable-line react-hooks/exhaustive-deps

  const target = targetId === 'self' ? conn : saved.find((c) => c.id === targetId)
  const cat = useTargetCatalog(connId, target, targetId === 'self', targetDb)
  const srcOptions = useMemo(() => srcTables.map(label), [srcTables])
  const dstOptions = useMemo(() => cat.tables.filter((t) => t.type !== 'view').map(label), [cat.tables])

  const compare = async () => {
    if (!source || !target || !keyCols.length) return
    setBusy('Connecting…'); setError(''); setDiffs(null); setSummary(null)
    let tid = ''
    try {
      tid = targetId === 'self' && !targetDb ? connId : (await window.db.connect({ ...target.config, database: targetDb || target.config.database })).id
      const tables = await window.db.listTables(tid)
      const want = targetTable.trim().toLowerCase()
      const dstT = tables.find((t) => label(t).toLowerCase() === want) ?? tables.find((t) => t.name.toLowerCase() === want.split('.').pop())
      if (!dstT) throw new Error(`Table ${targetTable} was not found on the target`)
      if (tid === connId && tKey(dstT) === tKey(source)) throw new Error('Source and target are the same table')
      const order = keyCols.map((c) => ({ col: c, dir: 'asc' as const }))
      setBusy('Reading rows…')
      const [a, b] = await Promise.all([
        window.db.selectPage(connId, source, { offset: 0, limit: MAX_ROWS, orderBy: order }),
        window.db.selectPage(tid, dstT, { offset: 0, limit: MAX_ROWS, orderBy: order })
      ])
      setBusy('Comparing…')
      const lower = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v]))
      const keyOf = (r: Row) => keyCols.map((k) => norm(r[k.toLowerCase()])).join('\u0001')
      const shared = a.columns.filter((c) => b.columns.some((d) => d.toLowerCase() === c.toLowerCase()))
      const dstMap = new Map<string, Row>()
      for (const r of b.rows.map(lower)) dstMap.set(keyOf(r), r)
      const out: DiffRow[] = []
      let same = 0
      for (const raw of a.rows) {
        const r = lower(raw)
        const k = keyOf(r)
        const d = dstMap.get(k)
        if (!d) { out.push({ key: k, status: 'source', src: raw, cols: [] }); continue }
        dstMap.delete(k)
        const cols = shared.filter((c) => norm(r[c.toLowerCase()]) !== norm(d[c.toLowerCase()]))
        if (cols.length) out.push({ key: k, status: 'changed', src: raw, dst: d, cols })
        else same++
      }
      for (const [k, d] of dstMap) out.push({ key: k, status: 'target', dst: d, cols: [] })
      setDiffs(out)
      const count = (s: Status) => out.filter((x) => x.status === s).length
      const capped = a.rows.length >= MAX_ROWS || b.rows.length >= MAX_ROWS
      setSummary({ same, changed: count('changed'), source: count('source'), target: count('target'), capped })
      setAllCols(shared)
      onStatus(`${out.length.toLocaleString()} rows differ · ${same.toLocaleString()} match`)
    } catch (e) { setError(errMsg(e)) } finally {
      if (tid && tid !== connId) window.db.disconnect(tid).catch(() => {})
      setBusy('')
    }
  }

  const script = useMemo(() => {
    if (!diffs || !source) return ''
    if (!diffs.length) return '-- The rows match'
    const ref = tableRef(engine, (() => { const p = targetTable.split('.'); return p.length > 1 ? { schema: p[0], name: p.slice(1).join('.') } : { name: p[0] } })())
    const q = (c: string) => quote(engine, c)
    const get = (r: Row | undefined, c: string) => r?.[c] ?? r?.[c.toLowerCase()]
    const where = (r: Row | undefined) => keyCols.map((k) => { const v = get(r, k); return v === null || v === undefined ? `${q(k)} IS NULL` : `${q(k)} = ${sqlLiteral(v)}` }).join(' AND ')
    const lines = [`-- Makes ${targetTable} on "${target?.name || 'target'}" match ${label(source)} on "${conn.name || 'this connection'}"`, `-- Generated ${new Date().toLocaleString()}. Review before running.`, '']
    for (const d of diffs) {
      if (d.status === 'source') lines.push(`INSERT INTO ${ref} (${allCols.map(q).join(', ')}) VALUES (${allCols.map((c) => sqlLiteral(get(d.src, c))).join(', ')});`)
      else if (d.status === 'changed') lines.push(`UPDATE ${ref} SET ${d.cols.map((c) => `${q(c)} = ${sqlLiteral(get(d.src, c))}`).join(', ')} WHERE ${where(d.src)};`)
      else lines.push(`${withDeletes ? '' : '-- '}DELETE FROM ${ref} WHERE ${where(d.dst)};`)
    }
    return lines.join('\n')
  }, [diffs, source, engine, targetTable, keyCols, allCols, withDeletes, target, conn.name])

  const runOnTarget = async () => {
    if (!target || !script.trim()) return
    if (!allowRun(target, checkSql(script, 'sql'))) return
    if (!target.production && !window.confirm(`Run ${diffs?.length.toLocaleString()} changes on "${target.name || 'this connection'}"?`)) return
    setBusy('Running on target…'); setError('')
    let tid = ''
    let done = 0
    const stmts = script.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    try {
      tid = targetId === 'self' && !targetDb ? connId : (await window.db.connect({ ...target.config, database: targetDb || target.config.database })).id
      // One statement per call: some drivers (SQLite) run only one at a time, and a failure names the row
      for (const s of stmts) {
        if (done % 50 === 0) setBusy(`Running ${done + 1} of ${stmts.length}…`)
        await window.db.queryMulti(tid, s)
        done++
      }
      onStatus(`Ran ${stmts.length} statements`)
    } catch (e) {
      setError(`Stopped after ${done} of ${stmts.length} statements. Failed: ${stmts[done]?.slice(0, 200)}\n${errMsg(e)}`)
      return
    } finally {
      if (tid && tid !== connId) window.db.disconnect(tid).catch(() => {})
      setBusy('')
    }
    // Compare again so the screen shows what is left (only after a clean run, so errors stay visible)
    await compare()
  }

  const visible = (diffs ?? []).filter((d) => show === 'all' || d.status === show).slice(0, 1000)
  const cell = (v: unknown) => (v === null || v === undefined ? <span className="null">NULL</span> : norm(v))

  return (
    <div className="compare-view data-compare">
      <div className="toolbar wrap">
        <div className="crumb"><strong>Data compare</strong></div>
        <Combo value={source ? label(source) : ''} options={srcOptions} free={false} width={240} placeholder="Source table…" title="Source table (this connection)"
          onChange={(v) => { const t = srcTables.find((x) => label(x) === v); setSrcTable(t ? tKey(t) : '') }} />
        <span className="muted">→</span>
        <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setTargetDb('') }} title="Target connection">
          <option value="self">This connection</option>
          {saved.map((c) => <option key={c.id} value={c.id}>{c.name || c.config.host || c.config.file}{c.production ? ' (Production)' : ''}</option>)}
        </select>
        {target && driverFor(target.config.kind).mode === 'server' && (
          <Combo value={targetDb} options={cat.databases} width={180} placeholder={target.config.database || 'Default database'} title="Target database (empty = the connection's default)"
            loading={cat.loading && !cat.databases.length} onChange={setTargetDb} />
        )}
        <Combo value={targetTable} options={dstOptions} width={240} placeholder="Target table…" title="Target table" loading={cat.loading} onChange={setTargetTable} />
        <button className="btn btn-sm btn-primary" disabled={!source || !keyCols.length || !!busy} onClick={compare}>Compare</button>
        <div className="spacer" />
        {busy && <span className="muted small-text">{busy}</span>}
      </div>
      {source && (
        <div className="toolbar key-row">
          <span className="muted small-text">Match rows by:</span>
          {allCols.map((c) => (
            <label key={c} className={`chip ${keyCols.includes(c) ? 'on' : ''}`}>
              <input type="checkbox" checked={keyCols.includes(c)} onChange={(e) => setKeyCols((k) => (e.target.checked ? [...k, c] : k.filter((x) => x !== c)))} />{c}
            </label>
          ))}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {summary?.capped && <div className="notice">Only the first {MAX_ROWS.toLocaleString()} rows of each table were compared.</div>}
      <div className="compare-body">
        <div className="compare-list">
          {!summary && <div className="placeholder">Pick a source table and a target, then press Compare. Rows are matched by the key columns (the primary key by default).</div>}
          {summary && (
            <>
              <div className="result-tabs">
                {([['all', 'All differences', summary.changed + summary.source + summary.target], ['changed', 'Changed', summary.changed], ['source', 'Only in source', summary.source], ['target', 'Only in target', summary.target]] as const).map(([id, name, n]) => (
                  <button key={id} className={show === id ? 'on' : ''} onClick={() => setShow(id)}>{name} <span className="badge">{n.toLocaleString()}</span></button>
                ))}
                <span className="muted small-text pad-l">{summary.same.toLocaleString()} identical</span>
              </div>
              {diffs?.length === 0 && <div className="placeholder ok">✓ Every row matches.</div>}
              <div className="dc-grid-wrap">
                <table className="dc-grid">
                  <thead><tr><th /><th>Side</th>{allCols.map((c) => <th key={c} className={keyCols.includes(c) ? 'key' : ''}>{c}</th>)}</tr></thead>
                  <tbody>
                    {visible.map((d) => (
                      d.status === 'changed' ? [
                        <tr key={d.key + 's'} className="dc-changed first"><td rowSpan={2}><span className="diff-tag changed">Changed</span></td><td className="muted">source</td>
                          {allCols.map((c) => <td key={c} className={d.cols.includes(c) ? 'diff-cell' : ''}>{cell(d.src?.[c])}</td>)}</tr>,
                        <tr key={d.key + 't'} className="dc-changed"><td className="muted">target</td>
                          {allCols.map((c) => <td key={c} className={d.cols.includes(c) ? 'diff-cell old' : ''}>{cell(d.dst?.[c.toLowerCase()])}</td>)}</tr>
                      ] : (
                        <tr key={d.key} className={`dc-${d.status}`}>
                          <td><span className={`diff-tag ${d.status === 'source' ? 'missing' : 'extra'}`}>{d.status === 'source' ? 'Only in source' : 'Only in target'}</span></td>
                          <td className="muted">{d.status}</td>
                          {allCols.map((c) => <td key={c}>{cell(d.status === 'source' ? d.src?.[c] : d.dst?.[c.toLowerCase()])}</td>)}
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
                {(diffs?.filter((d) => show === 'all' || d.status === show).length ?? 0) > 1000 && <div className="muted small-text pad">Showing the first 1,000 differences; the script covers all of them.</div>}
              </div>
            </>
          )}
        </div>
        <div className="compare-script">
          <div className="toolbar">
            <strong className="small-text">Sync script</strong>
            <label className="check small-text"><input type="checkbox" checked={withDeletes} onChange={(e) => setWithDeletes(e.target.checked)} /> Delete rows only in target</label>
            <div className="spacer" />
            <button className="btn btn-sm" disabled={!script} onClick={() => navigator.clipboard?.writeText(script)}><IconCopy width={13} height={13} /> Copy</button>
            <button className="btn btn-sm" disabled={!diffs?.length || !!busy} onClick={runOnTarget}>Run on target</button>
          </div>
          <CodeMirror value={script} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={[sqlLang()]} editable={false} basicSetup={{ foldGutter: false }} />
        </div>
      </div>
    </div>
  )
}
