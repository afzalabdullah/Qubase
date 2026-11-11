import { useState } from 'react'
import type { ColumnInfo, ImportData, RowChange, TableInfo } from '../../shared/types'
import { IconUpload, IconX } from './Icons'
import { errMsg } from '../util'
import { allowRun } from '../safety'
import { useConn } from '../settings'

const BATCH = 500
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Import rows from CSV, Excel or JSON into a table, with column mapping. */
export function ImportDialog({ table, columns, onClose, onDone }: { table: TableInfo; columns: ColumnInfo[]; onClose: () => void; onDone: (n: number) => void }) {
  const { conn, connId } = useConn()
  const [file, setFile] = useState('')
  const [data, setData] = useState<ImportData | null>(null)
  const [map, setMap] = useState<Record<string, string>>({})
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    setError('')
    const f = await window.db.pickFile('data')
    if (!f) return
    setBusy(true)
    try {
      const d = await window.db.readImportFile(f)
      setFile(f); setData(d)
      // Match file columns to table columns by name, ignoring case and punctuation.
      // Auto-increment columns are skipped so the database numbers the new rows.
      const byName = new Map(d.columns.map((c) => [norm(c), c]))
      setMap(Object.fromEntries(columns.map((c) => [c.name, c.autoIncrement ? '' : byName.get(norm(c.name)) ?? ''])))
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  const mapped = Object.entries(map).filter(([, src]) => src)

  const run = async () => {
    if (!data || !mapped.length) return
    if (!allowRun(conn, { what: `import ${data.rows.length.toLocaleString()} rows into ${table.name}` })) return
    setBusy(true); setError('')
    let done = 0
    try {
      for (let i = 0; i < data.rows.length; i += BATCH) {
        const changes: RowChange[] = data.rows.slice(i, i + BATCH).map((r) => ({
          op: 'insert', table,
          values: Object.fromEntries(mapped.map(([col, src]) => [col, r[src] === '' || r[src] === undefined ? null : r[src]]))
        }))
        await window.db.applyChanges(connId, changes)
        done += changes.length
        setProgress({ done, total: data.rows.length })
      }
      onDone(done)
      onClose()
    } catch (e) {
      // Each batch is its own transaction, so earlier batches stay imported
      setError(`Stopped after ${done.toLocaleString()} rows (row ${done + 1}–${Math.min(done + BATCH, data.rows.length)} failed): ${errMsg(e)}`)
      if (done) onDone(done)
    } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal import-modal" role="dialog" aria-label="Import data">
        <div className="modal-head">
          <IconUpload /><strong>Import into {table.name}</strong>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} disabled={busy} title="Close"><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="import-file">
            <button className="btn" onClick={pick} disabled={busy}>Choose file…</button>
            <span className="muted small-text">{file || 'CSV, TSV, Excel (.xlsx, first sheet) or JSON array'}</span>
          </div>
          {data && (
            <>
              <p className="small-text">{data.rows.length.toLocaleString()} rows · {data.columns.length} columns in the file. Pick which file column fills each table column; unmapped columns use their default.</p>
              <div className="import-map">
                {columns.map((c) => (
                  <label key={c.name} className="map-row">
                    <span className="map-col">{c.name} <span className="muted small-text">{c.dataType}{c.primaryKey ? ' · PK' : ''}{c.autoIncrement ? ' · auto' : ''}</span></span>
                    <select value={map[c.name] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [c.name]: e.target.value }))}>
                      <option value="">(skip)</option>
                      {data.columns.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <span className="map-sample muted small-text">{map[c.name] ? String(data.rows[0]?.[map[c.name]] ?? 'NULL').slice(0, 40) : ''}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          {progress && <div className="import-progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /><span>{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span></div>}
          {error && <div className="notice error">{error}</div>}
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || !data || !mapped.length}>
            {busy && progress ? 'Importing…' : `Import ${data ? data.rows.length.toLocaleString() : ''} rows`}
          </button>
        </div>
      </div>
    </div>
  )
}
