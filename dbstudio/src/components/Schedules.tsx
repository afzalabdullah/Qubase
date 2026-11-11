import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql as sqlLang } from '@codemirror/lang-sql'
import type { ExportFormat, SavedConnection, Schedule } from '../../shared/types'
import { IconFolder, IconPlay, IconPlus, IconTrash } from './Icons'
import { errMsg } from '../util'
import { readSettings, useConn } from '../settings'
import { editorTheme } from '../editorThemes'

const FORMATS: [ExportFormat, string][] = [['csv', 'CSV'], ['excel', 'Excel (.xlsx)'], ['json', 'JSON'], ['html', 'HTML'], ['markdown', 'Markdown'], ['sql', 'SQL INSERTs']]

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
                <select value={edit.connectionId} onChange={(e) => set({ connectionId: e.target.value })}>
                  {conns.map((c) => <option key={c.id} value={c.id}>{c.name || c.config.host || c.config.file}</option>)}
                </select>
              </label>
              <label className="field"><span>Database</span><input value={edit.database ?? ''} onChange={(e) => set({ database: e.target.value || undefined })} placeholder="Connection's default" /></label>
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
              <CodeMirror value={edit.sql} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={[sqlLang()]} onChange={(v) => set({ sql: v })} basicSetup={{ foldGutter: false }} />
            </div>
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
