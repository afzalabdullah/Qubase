import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, ToolboxComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { QueryResult } from '../../shared/types'
import { ChartCfg, ChartKind, PinContext } from '../dashboard'
import { cellText } from '../util'

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, ToolboxComponent, SVGRenderer])

const KINDS: { k: ChartKind; label: string }[] = [
  { k: 'bar', label: 'Bar' }, { k: 'hbar', label: 'Horizontal' }, { k: 'stacked', label: 'Stacked' }, { k: 'line', label: 'Line' },
  { k: 'area', label: 'Area' }, { k: 'scatter', label: 'Scatter' }, { k: 'pie', label: 'Pie' }, { k: 'donut', label: 'Donut' }
]
const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b']
const MAX_POINTS = 2000

const num = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : typeof v === 'number' ? v : Number(v))
const cssVar = (n: string, f: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f

/** Interactive chart of a result (Apache ECharts): one label column, one or more number columns. */
export function ChartView({ result, order, initial, compact }: { result: QueryResult; order: number[]; initial?: ChartCfg; compact?: boolean }) {
  const pin = useContext(PinContext)
  const [pinned, setPinned] = useState(false)
  const numeric = useMemo(() => result.columns.filter((c) => {
    const sample = order.slice(0, 50).map((i) => result.rows[i][c]).filter((v) => v !== null && v !== undefined)
    return sample.length > 0 && sample.every((v) => Number.isFinite(num(v)))
  }), [result, order])
  const labels = result.columns.filter((c) => !numeric.includes(c))
  const [kind, setKind] = useState<ChartKind>(initial?.kind ?? 'bar')
  const [x, setX] = useState(initial?.x && result.columns.includes(initial.x) ? initial.x : labels[0] ?? result.columns[0])
  const [ys, setYs] = useState<string[]>(initial?.ys ?? numeric.filter((c) => c !== x).slice(0, 1))
  const series = ys.filter((c) => result.columns.includes(c))
  const single = kind === 'pie' || kind === 'donut'

  const box = useRef<HTMLDivElement>(null)
  const inst = useRef<echarts.ECharts | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => {
    const on = () => setThemeTick((t) => t + 1)
    window.addEventListener('qubase:settings', on)
    return () => window.removeEventListener('qubase:settings', on)
  }, [])

  useEffect(() => {
    if (!box.current) return
    const c = echarts.init(box.current, undefined, { renderer: 'svg' })
    inst.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(box.current)
    return () => { ro.disconnect(); c.dispose(); inst.current = null }
  }, [])

  useEffect(() => {
    const c = inst.current
    if (!c || !series.length) { c?.clear(); return }
    const rows = order.slice(0, MAX_POINTS).map((i) => result.rows[i])
    const text = cssVar('--text-2', '#555'), grid = cssVar('--border', '#e5e7eb'), bg = cssVar('--bg', '#fff')
    const cats = rows.map((r) => cellText(r[x]))
    const tooltip = { trigger: single || kind === 'scatter' ? 'item' : 'axis', confine: true, backgroundColor: bg, borderColor: grid, textStyle: { color: cssVar('--text', '#111') } }
    const legend = { show: !compact || series.length > 1 || single, type: 'scroll', bottom: 0, textStyle: { color: text } }
    let option: echarts.EChartsCoreOption
    if (single) {
      const sums = new Map<string, number>()
      for (const r of rows) { const k = cellText(r[x]); sums.set(k, (sums.get(k) ?? 0) + Math.max(0, num(r[series[0]]) || 0)) }
      let parts = [...sums.entries()].sort((a, b) => b[1] - a[1])
      if (parts.length > 12) parts = [...parts.slice(0, 11), ['Other', parts.slice(11).reduce((a, p) => a + p[1], 0)]]
      option = {
        color: PALETTE, tooltip: { ...tooltip, valueFormatter: (v: number) => v.toLocaleString() }, legend,
        series: [{ type: 'pie', radius: kind === 'donut' ? ['45%', '72%'] : '72%', center: ['50%', '46%'], itemStyle: { borderColor: bg, borderWidth: 2, borderRadius: kind === 'donut' ? 6 : 0 },
          label: { color: text, formatter: '{b}: {d}%' }, data: parts.map(([name, value]) => ({ name, value })) }]
      }
    } else {
      const horiz = kind === 'hbar'
      const catAxis = { type: 'category', data: cats, axisLabel: { color: text, hideOverlap: true }, axisLine: { lineStyle: { color: grid } } }
      const valAxis = { type: 'value', axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } }
      const type = kind === 'line' || kind === 'area' ? 'line' : kind === 'scatter' ? 'scatter' : 'bar'
      option = {
        color: PALETTE, tooltip, legend,
        grid: { left: 8, right: 16, top: compact ? 12 : 36, bottom: compact ? 28 : 56, containLabel: true },
        toolbox: compact ? undefined : { right: 8, top: 0, feature: { dataZoom: { yAxisIndex: 'none', title: { zoom: 'Zoom', back: 'Undo zoom' } }, restore: { title: 'Reset' }, saveAsImage: { title: 'Save image', name: 'chart' } }, iconStyle: { borderColor: text } },
        dataZoom: !compact && rows.length > 30 ? [{ type: 'inside', [horiz ? 'yAxisIndex' : 'xAxisIndex']: 0 }, { type: 'slider', height: 16, bottom: 26, [horiz ? 'yAxisIndex' : 'xAxisIndex']: 0 }] : undefined,
        xAxis: horiz ? valAxis : catAxis,
        yAxis: horiz ? catAxis : valAxis,
        series: series.map((col) => ({
          name: col, type, data: rows.map((r) => { const v = num(r[col]); return Number.isFinite(v) ? v : null }),
          stack: kind === 'stacked' ? 'all' : undefined, smooth: type === 'line', showSymbol: rows.length < 60,
          areaStyle: kind === 'area' ? { opacity: 0.18 } : undefined, barMaxWidth: 48,
          itemStyle: type === 'bar' ? { borderRadius: horiz ? [0, 4, 4, 0] : [4, 4, 0, 0] } : undefined,
          emphasis: { focus: 'series' }
        }))
      }
    }
    c.setOption(option, true)
  }, [result, order, kind, x, series.join('|'), compact, themeTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!numeric.length) return <div className="placeholder">No number columns to chart. Charts need at least one numeric column.</div>

  return (
    <div className={`chart-view ${compact ? 'compact' : ''}`}>
      {!compact && <div className="chart-bar">
        <select value={kind} onChange={(e) => { const k = e.target.value as ChartKind; setKind(k); if ((k === 'pie' || k === 'donut') && ys.length > 1) setYs(ys.slice(0, 1)) }} title="Chart type">
          {KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
        </select>
        <label>Label <select value={x} onChange={(e) => setX(e.target.value)}>{result.columns.map((c) => <option key={c}>{c}</option>)}</select></label>
        <span className="muted small-text">Values</span>
        {numeric.map((c) => (
          <label key={c} className="chip"><input type={single ? 'radio' : 'checkbox'} checked={ys.includes(c)}
            onChange={(e) => setYs((cur) => single ? [c] : e.target.checked ? [...cur, c] : cur.filter((y) => y !== c))} />{c}</label>
        ))}
        {order.length > MAX_POINTS && <span className="muted small-text">First {MAX_POINTS} rows</span>}
        {pin && <><span className="spacer" /><button className="btn btn-sm" disabled={!series.length} title="Add this chart to the dashboard; it re-runs the query on each refresh"
          onClick={() => { pin({ kind, x, ys: series }); setPinned(true); setTimeout(() => setPinned(false), 1800) }}>{pinned ? '✓ Pinned' : '📌 Pin to dashboard'}</button></>}
      </div>}
      {!series.length && <div className="placeholder">Pick a value column</div>}
      <div ref={box} className="chart-canvas" style={{ display: series.length ? undefined : 'none' }} />
    </div>
  )
}
