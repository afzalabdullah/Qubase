import { useContext, useMemo, useState } from 'react'
import { ChartCfg, PinContext } from '../dashboard'
import type { QueryResult } from '../../shared/types'
import { cellText } from '../util'

type Kind = 'bar' | 'line' | 'pie'
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b']
const MAX_POINTS = 500

const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : typeof v === 'number' ? v : Number(v))

/** Quick chart of a result: one label column, one or more number columns. */
export function ChartView({ result, order, initial, compact }: { result: QueryResult; order: number[]; initial?: ChartCfg; compact?: boolean }) {
  const pin = useContext(PinContext)
  const [pinned, setPinned] = useState(false)
  const numeric = useMemo(() => result.columns.filter((c) => {
    const sample = order.slice(0, 50).map((i) => result.rows[i][c]).filter((v) => v !== null && v !== undefined)
    return sample.length > 0 && sample.every((v) => Number.isFinite(num(v)))
  }), [result, order])
  const labels = result.columns.filter((c) => !numeric.includes(c))
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'bar')
  const [x, setX] = useState(initial?.x && result.columns.includes(initial.x) ? initial.x : labels[0] ?? result.columns[0])
  const [ys, setYs] = useState<string[]>(initial?.ys ?? numeric.filter((c) => c !== x).slice(0, 1))

  const rows = order.slice(0, MAX_POINTS).map((i) => result.rows[i])
  const series = ys.filter((c) => result.columns.includes(c))
  const W = 900, H = 340, L = 60, R = 20, T = 16, B = 70

  if (!numeric.length) return <div className="placeholder">No number columns to chart. Charts need at least one numeric column.</div>

  const chart = () => {
    if (!series.length) return <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-note">Pick a value column</text>
    if (kind === 'pie') {
      const col = series[0]
      // Group by label and keep the 9 largest slices; the rest become "Other"
      const sums = new Map<string, number>()
      for (const r of rows) { const k = cellText(r[x]); sums.set(k, (sums.get(k) ?? 0) + Math.max(0, num(r[col]) || 0)) }
      let parts = [...sums.entries()].sort((a, b) => b[1] - a[1])
      if (parts.length > 10) parts = [...parts.slice(0, 9), ['Other', parts.slice(9).reduce((a, p) => a + p[1], 0)]]
      const total = parts.reduce((a, p) => a + p[1], 0) || 1
      let angle = -Math.PI / 2
      const cx = 200, cy = H / 2, rad = 140
      return (
        <>
          {parts.map(([k, v], i) => {
            const a = (v / total) * Math.PI * 2
            const x1 = cx + rad * Math.cos(angle), y1 = cy + rad * Math.sin(angle)
            angle += a
            const x2 = cx + rad * Math.cos(angle), y2 = cy + rad * Math.sin(angle)
            const d = parts.length === 1 ? `M ${cx - rad} ${cy} a ${rad} ${rad} 0 1 0 ${rad * 2} 0 a ${rad} ${rad} 0 1 0 ${-rad * 2} 0` : `M ${cx} ${cy} L ${x1} ${y1} A ${rad} ${rad} 0 ${a > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`
            return <path key={k} d={d} fill={COLORS[i % COLORS.length]} stroke="var(--bg)" strokeWidth={2}><title>{`${k}: ${v.toLocaleString()} (${((v / total) * 100).toFixed(1)}%)`}</title></path>
          })}
          {parts.map(([k, v], i) => (
            <g key={k} transform={`translate(400, ${40 + i * 26})`}>
              <rect width={12} height={12} rx={2} fill={COLORS[i % COLORS.length]} />
              <text x={20} y={11} className="chart-text">{k.slice(0, 40)} · {((v / total) * 100).toFixed(1)}%</text>
            </g>
          ))}
        </>
      )
    }
    const vals = rows.flatMap((r) => series.map((c) => num(r[c]))).filter(Number.isFinite)
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals)
    const span = max - min || 1
    const plotW = W - L - R, plotH = H - T - B
    const yPos = (v: number) => T + plotH - ((v - min) / span) * plotH
    const step = plotW / Math.max(1, rows.length)
    const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
    const labelEvery = Math.ceil(rows.length / 20)
    return (
      <>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={yPos(t)} y2={yPos(t)} className="chart-grid" />
            <text x={L - 6} y={yPos(t) + 4} textAnchor="end" className="chart-text">{Math.abs(t) >= 1000 ? t.toLocaleString(undefined, { notation: 'compact' }) : +t.toFixed(2)}</text>
          </g>
        ))}
        {rows.map((r, i) => i % labelEvery === 0 && (
          <text key={i} transform={`translate(${L + step * i + step / 2}, ${H - B + 14}) rotate(35)`} className="chart-text">{cellText(r[x]).slice(0, 16)}</text>
        ))}
        {kind === 'bar' && series.map((c, s) => rows.map((r, i) => {
          const v = num(r[c]); if (!Number.isFinite(v)) return null
          const bw = Math.max(1, (step * 0.8) / series.length)
          const y0 = yPos(Math.max(0, min)), y1 = yPos(v)
          return <rect key={`${c}${i}`} x={L + step * i + step * 0.1 + bw * s} y={Math.min(y0, y1)} width={bw} height={Math.max(1, Math.abs(y1 - y0))} fill={COLORS[s % COLORS.length]}><title>{`${cellText(r[x])} · ${c}: ${v.toLocaleString()}`}</title></rect>
        }))}
        {kind === 'line' && series.map((c, s) => (
          <polyline key={c} fill="none" stroke={COLORS[s % COLORS.length]} strokeWidth={2}
            points={rows.map((r, i) => (Number.isFinite(num(r[c])) ? `${L + step * i + step / 2},${yPos(num(r[c]))}` : '')).filter(Boolean).join(' ')} />
        ))}
        {series.map((c, s) => (
          <g key={c} transform={`translate(${L + s * 150}, ${H - 14})`}>
            <rect width={12} height={12} rx={2} y={-10} fill={COLORS[s % COLORS.length]} /><text x={18} className="chart-text">{c}</text>
          </g>
        ))}
      </>
    )
  }

  return (
    <div className={`chart-view ${compact ? 'compact' : ''}`}>
      {!compact && <div className="chart-bar">
        {(['bar', 'line', 'pie'] as Kind[]).map((k) => <button key={k} className={`btn btn-sm ${kind === k ? 'btn-on' : ''}`} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        <label>Label <select value={x} onChange={(e) => setX(e.target.value)}>{result.columns.map((c) => <option key={c}>{c}</option>)}</select></label>
        <span className="muted small-text">Values</span>
        {numeric.map((c) => (
          <label key={c} className="chip"><input type={kind === 'pie' ? 'radio' : 'checkbox'} checked={ys.includes(c)}
            onChange={(e) => setYs((cur) => kind === 'pie' ? [c] : e.target.checked ? [...cur, c] : cur.filter((y) => y !== c))} />{c}</label>
        ))}
        {order.length > MAX_POINTS && <span className="muted small-text">First {MAX_POINTS} rows</span>}
        {pin && <><span className="spacer" /><button className="btn btn-sm" disabled={!series.length} title="Add this chart to the dashboard; it re-runs the query on each refresh"
          onClick={() => { pin({ kind, x, ys: series }); setPinned(true); setTimeout(() => setPinned(false), 1800) }}>{pinned ? '✓ Pinned' : '📌 Pin to dashboard'}</button></>}
      </div>}
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="xMidYMid meet">{chart()}</svg>
    </div>
  )
}
