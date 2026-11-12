import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang, MSSQL, PostgreSQL, MySQL, SQLite, PLSQL, StandardSQL, type SQLDialect, type SQLNamespace } from '@codemirror/lang-sql'
import type { ExportFormat, SavedConnection, Schedule, TableInfo } from '../../shared/types'
import { driverFor } from '../../shared/drivers'
import { IconFolder, IconPlay, IconPlus, IconTrash } from './Icons'
import { errMsg } from '../util'
import { readSettings, useConn } from '../settings'
import { editorTheme } from '../editorThemes'

const FORMATS: [ExportFormat, string][] = [['csv', 'CSV'], ['excel', 'Excel (.xlsx)'], ['json', 'JSON'], ['html', 'HTML'], ['markdown', 'Markdown'], ['sql', 'SQL INSERTs']]

const DIALECTS: Record<string, SQLDialect> = { mssql: MSSQL, postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, libsql: SQLite, oracle: PLSQL }
const DEFAULT_SCHEMA: Record<string, string> = { mssql: 'dbo', postgres: 'public' }

/**
 * A background connection to the schedule's connection (and database), for the database list
 * and the editor's table / column suggestions. Closed again when the connection changes.
 */
function useScheduleSchema(conn: SavedConnection | undefined, database: string | undefined, sqlText: string) {
  const [id, setId] = useState<string | null>(null)
  const [state, setState] = useState<'' | 'connecting' | 'ready' | 'error'>('')
  const [error, setError] = useState('')
  const [databases, setDatabases] = useState<string[] | null>(null)
  const [current, setCurrent] = useState('')
  const [tables, setTables] = useState<TableInfo[]>([])
  const [columns, setColumns] = useState<Record<string, { name: string; dataType: string }[]>>({})

  // (Re)connect when the connection or the chosen database changes
  useEffect(() => {
    if (!conn) return
    let cid: string | null = null, cancelled = false
    setState('connecting'); setError(''); setTables([]); setColumns({})
    const config = database ? { ...conn.config, database } : conn.config
    window.db.connect(config).then(async ({ id: newId }) => {
      if (cancelled) { window.db.disconnect(newId); return }
      cid = newId; setId(newId)
      const [dbs, ts] = await Promise.all([window.db.listDatabases(newId).catch(() => null), window.db.listTables(newId).catch(() => [])])
      if (cancelled) return
      setDatabases(dbs?.databases ?? null); setCurrent(dbs?.current ?? '')
      setTables(ts); setState('ready')
    }).catch((e) => { if (!cancelled) { setState('error'); setError(errMsg(e)); setDatabases(null) } })
    return () => { cancelled = true; setId(null); if (cid) window.db.disconnect(cid) }
  }, [conn?.id, database]) // eslint-disable-line react-hooks/exhaustive-deps

  // Small and medium databases: load every table's columns up front, so "alias." suggests them at once
  useEffect(() => {
    if (!id || !tables.length || tables.length > 300) return
    let cancelled = false
    const queue = [...tables]
    const worker = async () => {
      for (let t = queue.shift(); t && !cancelled; t = queue.shift()) {
        const key = `${t.schema ?? ''}.${t.name}`
        const cols = await window.db.listColumns(id, t).catch(() => null)
        if (cols && !cancelled) setColumns((c) => (c[key]?.length ? c : { ...c, [key]: cols.map((x) => ({ name: x.name, dataType: x.dataType })) }))
      }
    }
    Promise.all([worker(), worker(), worker(), worker()])
    return () => { cancelled = true }
  }, [id, tables])

  // Large databases: columns for the tables named in the query, so "o." suggests the columns of orders
  useEffect(() => {
    if (!id || !tables.length) return
    const t = setTimeout(() => {
      const words = new Set(sqlText.toLowerCase().match(/[\w$#@]+/g) ?? [])
      for (const tb of tables.filter((x) => words.has(x.name.toLowerCase()) && !columns[`${x.schema ?? ''}.${x.name}`]).slice(0, 10)) {
        const key = `${tb.schema ?? ''}.${tb.name}`
        setColumns((c) => ({ ...c, [key]: [] }))
        window.db.listColumns(id, tb).then((cols) => setColumns((c) => ({ ...c, [key]: cols.map((x) => ({ name: x.name, dataType: x.dataType })) }))).catch(() => {})
      }
    }, 250)
    return () => clearTimeout(t)
  }, [sqlText, tables, columns, id])

  const engine = conn ? driverFor(conn.config.kind).engine : ''
  const extensions = useMemo(() => {
    const ns: Record<string, Record<string, SQLNamespace>> = {}
    const top: Record<string, SQLNamespace> = {}
    for (const t of tables) {
      const cols = (columns[`${t.schema ?? ''}.${t.name}`] ?? []).map((c) => ({ label: c.name, type: 'property', detail: c.dataType }))
      const entry: SQLNamespace = { self: { label: t.name, type: t.type === 'view' ? 'interface' : 'class', detail: t.type === 'view' ? 'view' : 'table' }, children: cols }
      if (t.schema) (ns[t.schema] ??= {})[t.name] = entry
      else top[t.name] = entry
    }
    const schemas = Object.keys(ns)
    const defaultSchema = DEFAULT_SCHEMA[engine] && ns[DEFAULT_SCHEMA[engine]] ? DEFAULT_SCHEMA[engine] : schemas.length === 1 ? schemas[0] : undefined
    return [sqlLang({ dialect: DIALECTS[engine] ?? StandardSQL, upperCaseKeywords: true, schema: { ...ns, ...top } as SQLNamespace, defaultSchema })]
  }, [tables, columns, engine])

  return { state, error, databases, current, tables, extensions }
}

const when = (s: Schedule) => s.every === 'minutes' ? `every ${s.minutes ?? 60} min` : `${s.every === 'weekdays' ? 'weekdays' : 'daily'} at ${s.at ?? '08:00'}`
const ago = (t?: number) => (t ? new Date(t).toLocaleString() : '—')

/** Queries that run on a timer while the app is open and save the result to a file. */
export function Schedules({ dark, initialSql, onStatus }: { dark: boolean; initialSql?: string; onStatus: (s: string) => void }) {
  const { conn } = useConn()
  const [list, setList] = useState<Schedule[]>([])
  const [conns, setConns] = useState<SavedConnection[]>([])
  const [edit, setEdit] = useState<Schedule | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => window.db.listSchedules().then(setList).catch((e) => setError(errMsg(e)))
  useEffect(() => {
    load()
    window.db.listSaved().then(setConns).catch(() => {})
    return window.db.onSchedulesChanged(load)
  }, [])

  const blank = (sql = 'SELECT 1;'): Schedule => ({
    id: crypto.randomUUID(), name: 'Daily report', enabled: true, connectionId: conn.id, sql, every: 'daily', at: '08:00', minutes: 60,
    format: 'excel', folder: '', overwrite: false, notify: true
  })
  // Opened from a query tab: start a new schedule with that query
  useEffect(() => { if (initialSql) setEdit(blank(initialSql)) }, [initialSql]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!edit) return
    if (!edit.folder) { setError('Choose a folder for the files'); return }
    setError('')
    try { setList(await window.db.saveSchedule(edit)); setEdit(null); onStatus(`Saved schedule “${edit.name}”`) } catch (e) { setError(errMsg(e)) }
  }
  const runNow = async (s: Schedule) => {
    setBusy(s.id); setError('')
    try {
      const r = await window.db.runSchedule(s.id)
      onStatus(r.ok ? `${s.name}: ${r.rows} rows${r.file ? ' saved' : ''} in ${r.ms} ms` : `${s.name} failed: ${r.error}`)
      load()
    } catch (e) { setError(errMsg(e)) } finally { setBusy('') }
  }
  const toggle = async (s: Schedule) => setList(await window.db.saveSchedule({ ...s, enabled: !s.enabled }))
  const remove = async (s: Schedule) => { if (window.confirm(`Delete the schedule “${s.name}”?`)) setList(await window.db.deleteSchedule(s.id)) }
  const set = (p: Partial<Schedule>) => setEdit((e) => e && { ...e, ...p })
  const editConn = edit ? conns.find((c) => c.id === edit.connectionId) : undefined
  const schema = useScheduleSchema(editConn, edit?.database, edit?.sql ?? '')
  const connName = (id: string) => { const c = conns.find((x) => x.id === id); return c ? c.name || c.config.host || c.config.file : '(deleted connection)' }

  return (
    <div className="schedules">
      <div className="toolbar">
        <strong>Scheduled queries</strong>
        <span className="muted small-text">Run while Qubase is open; a run missed while it was closed happens at the next start.</span>
        <div className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => setEdit(blank())}><IconPlus width={12} height={12} /> New schedule</button>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="sched-body">
        <div className="sched-list">
          {list.length === 0 && !edit && <div className="placeholder">No schedules yet. A schedule runs a query on a timer and saves the result as a file, e.g. an Excel report every morning.</div>}
          {list.map((s) => {
            const last = s.history?.[0]
            return (
              <div key={s.id} className={`sched-item ${s.enabled ? '' : 'off'} ${edit?.id === s.id ? 'on' : ''}`}>
                <label className="switch" title={s.enabled ? 'On' : 'Off'}><input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} /></label>
                <div className="grow" onClick={() => setEdit(s)}>
                  <div><strong>{s.name}</strong> <span className="muted small-text">· {when(s)} · {FORMATS.find((f) => f[0] === s.format)?.[1]} · {connName(s.connectionId)}</span></div>
                  <div className="small-text muted">
                    Next: {s.enabled ? ago(s.nextRun) : 'off'} · Last: {last ? <>{ago(last.at)} <span className={last.ok ? 'ok-text' : 'err-text'}>{last.ok ? `✓ ${last.rows} rows` : `✗ ${last.error}`}</span></> : 'never'}
                  </div>
                </div>
                <button className="btn btn-sm" disabled={!!busy} onClick={() => runNow(s)}><IconPlay width={11} height={11} /> {busy === s.id ? 'Running…' : 'Run now'}</button>
                {last?.file && <button className="btn btn-sm" onClick={() => window.db.revealScheduleFile(s.id)} title={last.file}><IconFolder width={13} height={13} /></button>}
                <button className="icon-btn" title="Delete" onClick={() => remove(s)}><IconTrash width={13} height={13} /></button>
              </div>
            )
          })}
        </div>
        {edit && (
          <div className="sched-edit">
            <div className="form-grid">
              <label className="field span-2"><span>Name</span><input value={edit.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <label className="field"><span>Connection</span>
                {/* A new connection starts on its own default database */}
                <select value={edit.connectionId} onChange={(e) => set({ connectionId: e.target.value, database: undefined })}>
                  {conns.map((c) => <option key={c.id} value={c.id}>{c.name || c.config.host || c.config.file}</option>)}
                </select>
              </label>
              <label className="field"><span>Database {schema.state === 'connecting' && <span className="muted small-text">· loading…</span>}</span>
                {schema.databases
                  ? (
                    <select value={edit.database ?? ''} onChange={(e) => set({ database: e.target.value || undefined })}>
                      <option value="">Connection's default{schema.current && !edit.database ? ` (${schema.current})` : ''}</option>
                      {[...new Set([...(edit.database ? [edit.database] : []), ...schema.databases])].map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  )
                  : <input value={edit.database ?? ''} onChange={(e) => set({ database: e.target.value || undefined })} placeholder={schema.state === 'ready' ? 'This database type has one database' : "Connection's default"} />}
              </label>
              {schema.state === 'error' && <div className="notice error span-2">Could not connect to load databases and tables: {schema.error}</div>}
              <label className="field"><span>Repeat</span>
                <select value={edit.every} onChange={(e) => set({ every: e.target.value as Schedule['every'] })}>
                  <option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="minutes">Every N minutes</option>
                </select>
              </label>
              {edit.every === 'minutes'
                ? <label className="field"><span>Minutes</span><input type="number" min={1} value={edit.minutes ?? 60} onChange={(e) => set({ minutes: Math.max(1, Number(e.target.value) || 60) })} /></label>
                : <label className="field"><span>Time</span><input type="time" value={edit.at ?? '08:00'} onChange={(e) => set({ at: e.target.value })} /></label>}
              <label className="field"><span>Save as</span>
                <select value={edit.format} onChange={(e) => set({ format: e.target.value as ExportFormat })}>{FORMATS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select>
              </label>
              <label className="field"><span>File name</span><input value={edit.fileName ?? ''} onChange={(e) => set({ fileName: e.target.value || undefined })} placeholder={edit.name} /></label>
              <label className="field span-2"><span>Folder</span>
                <div className="input-group">
                  <input value={edit.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="C:\Reports" />
                  <button type="button" className="btn" onClick={async () => { const f = await window.db.pickFolder(); if (f) set({ folder: f }) }}><IconFolder /> Browse</button>
                </div>
              </label>
              <div className="checks span-2">
                <label className="check"><input type="checkbox" checked={!!edit.overwrite} onChange={(e) => set({ overwrite: e.target.checked })} /> Overwrite the same file (otherwise the date and time are added)</label>
                <label className="check"><input type="checkbox" checked={!!edit.notify} onChange={(e) => set({ notify: e.target.checked })} /> Windows notification after each run</label>
              </div>
            </div>
            <div className="sched-sql">
              <CodeMirror value={edit.sql} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={schema.extensions} onChange={(v) => set({ sql: v })} basicSetup={{ foldGutter: false }} />
            </div>
            <p className="muted small-text sched-ctx">
              {schema.state === 'ready' ? `${schema.tables.length} tables${edit.database || schema.current ? ` in ${edit.database || schema.current}` : ''} · type to get table suggestions, “alias.” for columns (Ctrl+Space shows the list)` : schema.state === 'connecting' ? 'Loading tables…' : ''}
            </p>
            <p className="muted small-text">The last result set of the query is saved. Queries that change data run too, so use them with care.</p>
            {edit.history?.length ? (
              <details><summary className="small-text">Last {edit.history.length} runs</summary>
                <ul className="sched-history">{edit.history.map((h) => <li key={h.at} className={h.ok ? '' : 'err-text'}>{ago(h.at)} · {h.ok ? `${h.rows} rows · ${h.ms} ms${h.file ? ` · ${h.file}` : ''}` : h.error}</li>)}</ul>
              </details>
            ) : null}
            <div className="form-actions">
              <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save schedule</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
