import { useEffect, useMemo, useRef, useState } from 'react'
import type { TableInfo, TableStructure } from '../../shared/types'
import { IconRefresh } from './Icons'
import { errMsg } from '../util'
import { useConn } from '../settings'

const BOX_W = 230, HEAD_H = 28, ROW_H = 19, MAX_COLS = 14, GAP_X = 90, GAP_Y = 50
const MAX_TABLES = 150

interface Box { t: TableInfo; s: TableStructure; key: string }
const keyOf = (t: { schema?: string; name: string }) => `${t.schema ?? ''}.${t.name}`.toLowerCase()

/** Run tasks a few at a time */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

/** Entity-relationship diagram drawn from the foreign keys. Drag tables to move them; scroll to zoom. */
export function ErDiagram({ onOpenTable }: { onOpenTable: (t: TableInfo) => void }) {
  const { connId } = useConn()
  const [boxes, setBoxes] = useState<Box[]>([])
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({})
  const [view, setView] = useState({ x: 20, y: 20, k: 0.8 })
  const [schema, setSchema] = useState('')
  const [schemas, setSchemas] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [hover, setHover] = useState('')
  const svgRef = useRef<SVGSVGElement>(null)

  const load = async () => {
    setError(''); setStatus('Loading tables…')
    try {
      const all = (await window.db.listTables(connId)).filter((t) => t.type !== 'view')
      const sch = [...new Set(all.map((t) => t.schema ?? ''))].filter(Boolean)
      setSchemas(sch)
      const picked = all.filter((t) => !schema || t.schema === schema).slice(0, MAX_TABLES)
      let done = 0
      const structs = await pool(picked, 6, async (t) => {
        const s = await window.db.getStructure(connId, t).catch(() => ({ columns: [], indexes: [], foreignKeys: [], triggers: [] }))
        setStatus(`Reading structure ${++done} / ${picked.length}…`)
        return s
      })
      const list = picked.map((t, i) => ({ t, s: structs[i], key: keyOf(t) }))
      setBoxes(list)
      setPos(layout(list))
      setStatus(all.length > picked.length && !schema ? `Showing the first ${MAX_TABLES} of ${all.length} tables; pick a schema to narrow it down.` : '')
    } catch (e) { setError(errMsg(e)); setStatus('') }
  }
  useEffect(() => { load() }, [connId, schema])

  const height = (b: Box) => HEAD_H + Math.min(b.s.columns.length, MAX_COLS + 1) * ROW_H + 6
  const byKey = useMemo(() => new Map(boxes.map((b) => [b.key, b])), [boxes])

  /** Tables with the most links go in the middle of the grid, linked tables near each other. */
  function layout(list: Box[]) {
    const deg = new Map(list.map((b) => [b.key, 0]))
    const links = new Map(list.map((b) => [b.key, new Set<string>()]))
    for (const b of list) for (const fk of b.s.foreignKeys) {
      const to = keyOf({ schema: fk.refSchema ?? b.t.schema, name: fk.refTable })
      if (!deg.has(to)) continue
      deg.set(b.key, deg.get(b.key)! + 1); deg.set(to, deg.get(to)! + 1)
      links.get(b.key)!.add(to); links.get(to)!.add(b.key)
    }
    // Breadth-first from the most connected table keeps neighbours together
    const order: string[] = [], seen = new Set<string>()
    for (const start of [...list].sort((a, b) => deg.get(b.key)! - deg.get(a.key)!).map((b) => b.key)) {
      if (seen.has(start)) continue
      const q = [start]; seen.add(start)
      while (q.length) {
        const k = q.shift()!; order.push(k)
        for (const n of [...links.get(k)!].sort((a, b) => deg.get(b)! - deg.get(a)!)) if (!seen.has(n)) { seen.add(n); q.push(n) }
      }
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(order.length * 1.6)))
    const out: Record<string, { x: number; y: number }> = {}
    const map = new Map(list.map((b) => [b.key, b]))
    let y = 0
    for (let r = 0; r * cols < order.length; r++) {
      const row = order.slice(r * cols, r * cols + cols)
      row.forEach((k, c) => { out[k] = { x: c * (BOX_W + GAP_X), y } })
      y += Math.max(...row.map((k) => height(map.get(k)!))) + GAP_Y
    }
    return out
  }

  // ---- pan, zoom, drag ----
  const drag = useRef<{ kind: 'pan' | 'box'; key?: string; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const onDown = (e: React.MouseEvent, key?: string) => {
    e.stopPropagation()
    const p = key ? pos[key] : view
    drag.current = { kind: key ? 'box' : 'pan', key, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y }
  }
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    else setPos((p) => ({ ...p, [d.key!]: { x: d.ox + dx / view.k, y: d.oy + dy / view.k } }))
  }
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const k = Math.min(2.5, Math.max(0.15, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    setView((v) => ({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }))
  }

  // ---- foreign key lines ----
  const lines = boxes.flatMap((b) => b.s.foreignKeys.flatMap((fk) => {
    const target = byKey.get(keyOf({ schema: fk.refSchema ?? b.t.schema, name: fk.refTable }))
    const a = pos[b.key], t = target && pos[target.key]
    if (!target || !a || !t) return []
    const colIdx = Math.min(MAX_COLS, Math.max(0, b.s.columns.findIndex((c) => c.name === fk.columns[0])))
    const refIdx = Math.min(MAX_COLS, Math.max(0, target.s.columns.findIndex((c) => c.name === fk.refColumns[0])))
    const y1 = a.y + HEAD_H + colIdx * ROW_H + ROW_H / 2
    const y2 = t.y + HEAD_H + refIdx * ROW_H + ROW_H / 2
    const rightward = t.x > a.x + BOX_W / 2
    const x1 = rightward ? a.x + BOX_W : a.x
    const x2 = target === b ? a.x + BOX_W : rightward ? t.x : t.x + BOX_W
    const bend = target === b ? 60 : Math.max(40, Math.abs(x2 - x1) / 2)
    const c1 = rightward || target === b ? x1 + bend : x1 - bend
    const c2 = target === b ? x2 + bend : rightward ? x2 - bend : x2 + bend
    const on = hover === b.key || hover === target.key
    return [<path key={`${b.key}-${fk.name}`} d={`M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`} className={`er-line ${on ? 'on' : ''}`} markerEnd="url(#er-arrow)"><title>{`${b.t.name}.${fk.columns.join(', ')} → ${fk.refTable}.${fk.refColumns.join(', ')}`}</title></path>]
  }))

  return (
    <div className="er-view">
      <div className="toolbar">
        <div className="crumb"><strong>ER diagram</strong> <span className="muted">· {boxes.length} tables · drag tables to move · scroll to zoom · double-click a table to open it</span></div>
        <div className="spacer" />
        {schemas.length > 1 && (
          <select value={schema} onChange={(e) => setSchema(e.target.value)}>
            <option value="">All schemas</option>
            {schemas.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <button className="btn btn-sm" onClick={() => setPos(layout(boxes))}>Rearrange</button>
        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(svgRef.current?.outerHTML ?? '')}>Copy SVG</button>
        <button className="icon-btn" title="Reload" onClick={load}><IconRefresh /></button>
      </div>
      {status && <div className="notice">{status}</div>}
      {error && <div className="notice error">{error}</div>}
      <svg ref={svgRef} className="er-svg" onMouseDown={(e) => onDown(e)} onMouseMove={onMove} onMouseUp={() => { drag.current = null }} onMouseLeave={() => { drag.current = null }} onWheel={onWheel}>
        <defs>
          <marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" className="er-arrow" /></marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {lines}
          {boxes.map((b) => {
            const p = pos[b.key]
            if (!p) return null
            const fkCols = new Set(b.s.foreignKeys.flatMap((f) => f.columns))
            const shown = b.s.columns.slice(0, MAX_COLS)
            return (
              <g key={b.key} transform={`translate(${p.x} ${p.y})`} className={`er-box ${hover === b.key ? 'on' : ''}`}
                onMouseDown={(e) => onDown(e, b.key)} onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover('')}
                onDoubleClick={() => onOpenTable(b.t)}>
                <rect width={BOX_W} height={height(b)} rx={6} className="er-body" />
                <rect width={BOX_W} height={HEAD_H} rx={6} className="er-head" />
                <rect y={HEAD_H - 6} width={BOX_W} height={6} className="er-head" />
                <text x={10} y={18} className="er-title">{b.t.schema && <tspan className="er-schema">{b.t.schema}.</tspan>}{b.t.name.length > 26 ? b.t.name.slice(0, 25) + '…' : b.t.name}</text>
                {shown.map((c, i) => (
                  <g key={c.name} transform={`translate(0 ${HEAD_H + i * ROW_H})`}>
                    <text x={10} y={14} className={`er-col ${c.primaryKey ? 'pk' : ''}`}>{c.primaryKey ? '🔑 ' : fkCols.has(c.name) ? '↗ ' : ''}{c.name.length > 20 ? c.name.slice(0, 19) + '…' : c.name}</text>
                    <text x={BOX_W - 10} y={14} textAnchor="end" className="er-type">{c.dataType.length > 14 ? c.dataType.slice(0, 13) + '…' : c.dataType}</text>
                  </g>
                ))}
                {b.s.columns.length > MAX_COLS && <text x={10} y={HEAD_H + MAX_COLS * ROW_H + 14} className="er-type">… {b.s.columns.length - MAX_COLS} more columns</text>}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
