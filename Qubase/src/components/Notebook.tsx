import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql, MSSQL, PostgreSQL, MySQL, SQLite, PLSQL, StandardSQL } from '@codemirror/lang-sql'
import { keymap, EditorView } from '@codemirror/view'
import type { QueryResult } from '../../shared/types'
import { ResultView } from './ResultView'
import { IconArrowDown, IconArrowUp, IconFolder, IconPlay, IconPlus, IconStop, IconTrash } from './Icons'
import { Markdown } from '../markdown'
import { errMsg } from '../util'
import { allowRun, checkSql } from '../safety'
import { shortcutFor, useConn, useSettings } from '../settings'
import { editorTheme } from '../editorThemes'
import { toCodeMirror } from '../shortcuts'
import { snippetSource } from '../snippets'
import { formatSqlText } from '../format'

interface Cell {
  id: string
  type: 'sql' | 'note'
  text: string
  results?: QueryResult[]
  error?: string
  ms?: number
  /** Notes show their editor while true */
  editing?: boolean
}

/** File format (.dhnb): cells plus the first rows of each result */
interface NotebookFile { app: 'qubase' | 'datahive'; version: 1; title: string; cells: Omit<Cell, 'editing'>[] }

const SAVED_ROWS = 500
const DIALECTS: Record<string, typeof StandardSQL> = { mssql: MSSQL, postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite, libsql: SQLite, oracle: PLSQL }
const newCell = (type: Cell['type'], text = ''): Cell => ({ id: crypto.randomUUID(), type, text, editing: type === 'note' })

/** SQL cells and notes in one document; each SQL cell runs on its own and keeps its result. */
export function Notebook({ connId, dark, title, onTitle, onStatus, onRunningChange }: {
  connId: string; dark: boolean; title: string
  onTitle: (t: string) => void; onStatus: (s: string) => void; onRunningChange: (r: boolean) => void
}) {
  const { conn, engine } = useConn()
  const settings = useSettings()
  const [cells, setCells] = useState<Cell[]>(() => [
    { ...newCell('note', `# ${title}\nNotes go here. Double-click a note to edit it.`), editing: false },
    newCell('sql', 'SELECT 1;')
  ])
  const [running, setRunning] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const stopAll = useRef(false)

  // Own connection, like a query tab
  useEffect(() => {
    let id: string | null = null, cancelled = false
    window.db.openSession(connId)
      .then((s) => { if (cancelled) window.db.closeSession(connId, s); else { id = s; setSessionId(s) } })
      .catch(() => setSessionId(connId))
    return () => { cancelled = true; if (id) window.db.closeSession(connId, id) }
  }, [connId])

  const update = (id: string, patch: Partial<Cell>) => { setCells((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c))); if ('text' in patch) setDirty(true) }
  const cellsRef = useRef(cells)
  cellsRef.current = cells

  const runCell = async (id: string): Promise<boolean> => {
    const cell = cellsRef.current.find((c) => c.id === id)
    if (!cell || cell.type !== 'sql' || !sessionId || !cell.text.trim()) return true
    if (!allowRun(conn, checkSql(cell.text, 'sql'))) return false
    setRunning(id); onRunningChange(true)
    const start = performance.now()
    try {
      const results = await window.db.queryMulti(sessionId, cell.text, 10000)
      const ms = Math.round(performance.now() - start)
      update(id, { results, error: undefined, ms })
      onStatus(`Cell ran in ${ms} ms`)
      return true
    } catch (e) {
      update(id, { results: undefined, error: errMsg(e), ms: undefined })
      onStatus('Cell failed')
      return false
    } finally { setRunning(null); onRunningChange(false) }
  }

  const runAll = async () => {
    stopAll.current = false
    for (const c of cellsRef.current.filter((x) => x.type === 'sql')) {
      if (stopAll.current) break
      if (!(await runCell(c.id))) break // stop at the first failing cell
    }
  }

  const stop = () => { stopAll.current = true; if (sessionId) window.db.cancel(sessionId).catch(() => {}) }

  const add = (after: number, type: Cell['type']) => setCells((l) => { const n = [...l]; n.splice(after + 1, 0, newCell(type)); return n })
  const remove = (id: string) => { setCells((l) => l.filter((c) => c.id !== id)); setDirty(true) }
  const move = (i: number, dir: -1 | 1) => setCells((l) => {
    const j = i + dir
    if (j < 0 || j >= l.length) return l
    const n = [...l];[n[i], n[j]] = [n[j], n[i]]; return n
  })

  const save = async (as = false) => {
    const file: NotebookFile = {
      app: 'qubase', version: 1, title,
      cells: cells.map(({ editing: _e, ...c }) => ({ ...c, results: c.results?.map((r) => ({ ...r, rows: r.rows.slice(0, SAVED_ROWS), truncated: r.truncated || r.rows.length > SAVED_ROWS })) }))
    }
    try {
      const p = await window.db.saveTextFile(JSON.stringify(file, null, 1), { name: title, filter: 'Qubase notebook', ext: 'dhnb', path: as ? undefined : path ?? undefined })
      if (p) { setPath(p); setDirty(false); onStatus(`Saved ${p}`); onTitle(p.split(/[\\/]/).pop()!.replace(/\.dhnb$/i, '')) }
    } catch (e) { onStatus(`Save failed: ${errMsg(e)}`) }
  }

  const open = async () => {
    if (dirty && !window.confirm('Discard the changes in this notebook?')) return
    try {
      const f = await window.db.openTextFile({ filter: 'Qubase notebook', ext: 'dhnb' })
      if (!f) return
      const data = JSON.parse(f.content) as NotebookFile
      if ((data.app !== 'qubase' && data.app !== 'datahive') || !Array.isArray(data.cells)) throw new Error('This is not a Qubase notebook')
      setCells(data.cells.map((c) => ({ ...c, id: crypto.randomUUID(), editing: false })))
      setPath(f.path); setDirty(false)
      onTitle(f.path.split(/[\\/]/).pop()!.replace(/\.dhnb$/i, ''))
      onStatus(`Opened ${f.path}`)
    } catch (e) { onStatus(`Open failed: ${errMsg(e)}`) }
  }

  const lang = useMemo(() => sql({ dialect: DIALECTS[engine] ?? StandardSQL, upperCaseKeywords: true }), [engine])

  return (
    <div className="notebook">
      <div className="toolbar">
        <strong>{title}{dirty ? ' •' : ''}</strong>
        <div className="spacer" />
        {running
          ? <button className="btn btn-sm" onClick={stop}><IconStop width={12} height={12} /> Stop</button>
          : <button className="btn btn-sm btn-primary" onClick={runAll} disabled={!sessionId}><IconPlay width={12} height={12} /> Run all</button>}
        <button className="btn btn-sm" onClick={open}><IconFolder width={13} height={13} /> Open</button>
        <button className="btn btn-sm" onClick={() => save()} title={path ?? 'Save as a .dhnb file'}>Save</button>
        <button className="btn btn-sm" onClick={() => save(true)}>Save as…</button>
      </div>
      <div className="nb-cells">
        {cells.map((c, i) => (
          <div key={c.id} className={`nb-cell ${c.type} ${running === c.id ? 'running' : ''}`}>
            <div className="nb-gutter">
              {c.type === 'sql'
                ? <button className="icon-btn" title={`Run cell (${shortcutFor(settings, 'run')})`} disabled={!!running} onClick={() => runCell(c.id)}><IconPlay width={13} height={13} /></button>
                : <span className="nb-kind">Note</span>}
              {c.ms !== undefined && <span className="muted small-text">{c.ms} ms</span>}
            </div>
            <div className="nb-main">
              {c.type === 'sql' ? (
                <CodeMirror
                  value={c.text}
                  theme={editorTheme(settings.editorTheme, dark)}
                  minHeight="44px"
                  maxHeight="400px"
                  extensions={[
                    lang,
                    ...(settings.snippets ? [lang.language.data.of({ autocomplete: snippetSource })] : []),
                    keymap.of([
                      { key: toCodeMirror(shortcutFor(settings, 'run')), run: () => { runCell(c.id); return true } },
                      { key: 'Shift-Enter', run: () => { runCell(c.id).then((ok) => { if (ok && i === cellsRef.current.length - 1) add(i, 'sql') }); return true } },
                      { key: toCodeMirror(shortcutFor(settings, 'format')), run: () => { try { update(c.id, { text: formatSqlText(cellsRef.current.find((x) => x.id === c.id)!.text, engine) }) } catch { /* leave as is */ } return true } }
                    ].filter((k) => k.key)),
                    EditorView.theme({ '&': { fontSize: 'var(--editor-font, 13px)' } })
                  ]}
                  onChange={(v) => update(c.id, { text: v })}
                  basicSetup={{ foldGutter: false, highlightActiveLine: false }}
                />
              ) : c.editing ? (
                <textarea className="nb-note-edit" autoFocus value={c.text} rows={Math.max(3, c.text.split('\n').length)}
                  onChange={(e) => update(c.id, { text: e.target.value })}
                  onBlur={() => update(c.id, { editing: false })}
                  onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) { e.preventDefault(); update(c.id, { editing: false }) } }}
                  placeholder="Markdown: # heading, **bold**, - list, `code`" />
              ) : (
                <div className="nb-note" onDoubleClick={() => update(c.id, { editing: true })} title="Double-click to edit">
                  {c.text.trim() ? <Markdown text={c.text} /> : <span className="muted">Empty note (double-click to write)</span>}
                </div>
              )}
              {c.error && <div className="notice error">{c.error}</div>}
              {c.results?.map((r, k) => r.columns.length ? (
                <div key={k} className="nb-result" style={{ height: Math.min(360, 64 + r.rows.length * 26) }}>
                  <ResultView result={r} name={`${title} cell ${i + 1}`} onStatus={onStatus} />
                </div>
              ) : <div key={k} className="muted small-text nb-affected">{r.rowCount} row{r.rowCount === 1 ? '' : 's'} affected</div>)}
            </div>
            <div className="nb-actions">
              <button className="icon-btn" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}><IconArrowUp width={13} height={13} /></button>
              <button className="icon-btn" title="Move down" onClick={() => move(i, 1)} disabled={i === cells.length - 1}><IconArrowDown width={13} height={13} /></button>
              <button className="icon-btn" title="Delete cell" onClick={() => remove(c.id)}><IconTrash width={13} height={13} /></button>
            </div>
            <div className="nb-add">
              <button onClick={() => add(i, 'sql')}><IconPlus width={11} height={11} /> SQL</button>
              <button onClick={() => add(i, 'note')}><IconPlus width={11} height={11} /> Note</button>
            </div>
          </div>
        ))}
        {cells.length === 0 && (
          <div className="placeholder">
            <button className="btn" onClick={() => add(-1, 'sql')}><IconPlus /> SQL cell</button>{' '}
            <button className="btn" onClick={() => add(-1, 'note')}><IconPlus /> Note</button>
          </div>
        )}
        <p className="muted small-text nb-help">{shortcutFor(settings, 'run')} runs a cell · Shift+Enter runs it and adds a new one at the end · Results are saved with the notebook (first {SAVED_ROWS} rows).</p>
      </div>
    </div>
  )
}
