import { useCallback, useEffect, useState } from 'react'
import type { QueryResult } from '../../shared/types'
import { DASH_EVENT, readTiles, Tile, writeTiles } from '../dashboard'
import { useConn } from '../settings'
import { cellText, errMsg } from '../util'
import { ChartView } from './ChartView'

type State = { result?: QueryResult; error?: string; busy?: boolean }

/** Pinned charts that re-run their queries on demand or on a timer */
export function Dashboard({ onOpenQuery, onStatus }: { onOpenQuery: (title: string, text: string) => void; onStatus: (s: string) => void }) {
  const { conn, connId } = useConn()
  const [tiles, setTiles] = useState<Tile[]>(() => readTiles(conn.id))
  const [data, setData] = useState<Record<string, State>>({})
  const [every, setEvery] = useState(() => Number(localStorage.getItem(`dashEvery:${conn.id}`) ?? 0))
  const [at, setAt] = useState<Date | null>(null)
  const [renaming, setRenaming] = useState('')

  useEffect(() => {
    const on = () => setTiles(readTiles(conn.id))
    window.addEventListener(DASH_EVENT, on)
    return () => window.removeEventListener(DASH_EVENT, on)
  }, [conn.id])

  const runOne = useCallback(async (t: Tile) => {
    setData((d) => ({ ...d, [t.id]: { ...d[t.id], busy: true } }))
    try {
      const result = await window.db.query(connId, t.sql)
      setData((d) => ({ ...d, [t.id]: { result } }))
    } catch (e) { setData((d) => ({ ...d, [t.id]: { error: errMsg(e) } })) }
  }, [connId])
  const runAll = useCallback(async () => {
    await Promise.all(readTiles(conn.id).map(runOne))
    setAt(new Date())
  }, [conn.id, runOne])

  useEffect(() => { runAll() }, [runAll])
  // Newly pinned tiles run straight away
  useEffect(() => { tiles.forEach((t) => { if (!data[t.id]) runOne(t) }) }, [tiles]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(`dashEvery:${conn.id}`, String(every)) } catch { /* ignore */ }
    if (!every) return
    const h = setInterval(runAll, every * 60_000)
    return () => clearInterval(h)
  }, [every, runAll, conn.id])

  const save = (next: Tile[]) => { setTiles(next); writeTiles(conn.id, next) }
  const update = (id: string, p: Partial<Tile>) => save(tiles.map((t) => (t.id === id ? { ...t, ...p } : t)))
  const move = (i: number, d: number) => { const n = [...tiles]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; save(n) }

  return (
    <div className="dashboard">
      <div className="toolbar">
        <strong>Dashboard</strong>
        <span className="muted small-text">{tiles.length} {tiles.length === 1 ? 'chart' : 'charts'}{at ? ` · updated ${at.toLocaleTimeString()}` : ''}</span>
        <div className="spacer" />
        <label className="small-text">Auto-refresh{' '}
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            <option value={0}>Off</option><option value={1}>Every minute</option><option value={5}>Every 5 min</option><option value={15}>Every 15 min</option><option value={60}>Every hour</option>
          </select>
        </label>
        <button className="btn btn-sm btn-primary" onClick={() => { runAll(); onStatus('Dashboard refreshed') }} disabled={!tiles.length}>Refresh all</button>
      </div>
      {!tiles.length && <div className="placeholder">Nothing pinned yet. Run a query, open its Chart view, then press <strong>📌 Pin to dashboard</strong>.</div>}
      <div className="dash-grid">
        {tiles.map((t, i) => {
          const st = data[t.id] ?? {}
          const r = st.result
          const kpi = r && r.rows.length === 1 && r.columns.length === 1
          return (
            <div key={t.id} className={`dash-tile ${t.wide ? 'wide' : ''}`}>
              <div className="dash-head">
                {renaming === t.id
                  ? <input autoFocus defaultValue={t.title} onBlur={(e) => { update(t.id, { title: e.target.value.trim() || t.title }); setRenaming('') }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming('') }} />
                  : <strong title="Double-click to rename" onDoubleClick={() => setRenaming(t.id)}>{t.title}</strong>}
                {st.busy && <span className="muted small-text">…</span>}
                <span className="spacer" />
                <button className="icon-btn" title="Move left" onClick={() => move(i, -1)}>‹</button>
                <button className="icon-btn" title="Move right" onClick={() => move(i, 1)}>›</button>
                <button className="icon-btn" title={t.wide ? 'Make narrow' : 'Make wide'} onClick={() => update(t.id, { wide: !t.wide })}>{t.wide ? '⇥' : '⇔'}</button>
                <button className="icon-btn" title="Refresh" onClick={() => runOne(t)}>⟳</button>
                <button className="icon-btn" title="Rename" onClick={() => setRenaming(t.id)}>✎</button>
                <button className="icon-btn" title="Open the query" onClick={() => onOpenQuery(t.title, t.sql)}>{'</>'}</button>
                <button className="icon-btn" title="Remove from dashboard" onClick={() => { if (window.confirm(`Remove “${t.title}” from the dashboard?`)) save(tiles.filter((x) => x.id !== t.id)) }}>✕</button>
              </div>
              <div className="dash-body">
                {st.error && <div className="notice error">{st.error}</div>}
                {kpi && <div className="dash-kpi"><span>{cellText(r.rows[0][r.columns[0]])}</span><small>{r.columns[0]}</small></div>}
                {r && !kpi && r.columns.length > 0 && <ChartView compact result={r} order={r.rows.map((_, k) => k)} initial={t.chart} />}
                {r && !r.columns.length && <div className="placeholder">The query returned no rows.</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
