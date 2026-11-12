import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, ForeignKeyInfo, TableInfo, TableStructure } from '../../shared/types'
import { IconRefresh } from './Icons'
import { errMsg } from '../util'
import { useConn } from '../settings'

const HEAD_H = 34, ROW_H = 22, PAD_X = 12, GAP_X = 230, GAP_Y = 70, MIN_W = 190, MAX_W = 420
const MAX_TABLES = 1000
const NAME_CH = 7.2, TYPE_CH = 6.7, BADGE_W = 24

type ColMode = 'all' | 'keys' | 'names'
interface Box { t: TableInfo; s: TableStructure; key: string; w: number }
interface Rel { id: string; from: Box; to?: Box; fk: ForeignKeyInfo; one: boolean; optional: boolean }

const keyOf = (t: { schema?: string; name: string }) => `${t.schema ?? ''}.${t.name}`.toLowerCase()
const fullName = (t: TableInfo) => (t.schema ? `${t.schema}.${t.name}` : t.name)

/** Run tasks a few at a time */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.map((y) => y.toLowerCase()).includes(x.toLowerCase()))

/** Box width that fits the longest "badge name type" row */
function widthOf(t: TableInfo, s: TableStructure) {
  const title = (fullName(t).length + 4) * 7.6 + PAD_X * 2
  const rows = s.columns.map((c) => BADGE_W + c.name.length * NAME_CH + 18 + (c.dataType.length + 2) * TYPE_CH + PAD_X * 2)
  return Math.round(Math.min(MAX_W, Math.max(MIN_W, title, ...rows)))
}

/** Entity-relationship diagram: every column, labelled relationships with crow's-foot ends, export to images and text formats. */
class Cancelled extends Error {}

export function ErDiagram({ onOpenTable }: { onOpenTable: (t: TableInfo) => void }) {
  const { connId, conn } = useConn()
  const [bend, setBend] = useState<Record<string, { dx: number; dy: number }>>({})
  const layoutKey = () => `erLayout:${conn?.id ?? connId}:${schema}`
  const [boxes, setBoxes] = useState<Box[]>([])
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({})
  const [view, setView] = useState({ x: 20, y: 20, k: 0.85 })
  const [schema, setSchema] = useState('')
  const [schemas, setSchemas] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<{ label: string; step: string; pct: number; load?: boolean } | null>(null)
  const cancelRef = useRef(false)
  const step = (text: string, pct: number) => setBusy((b) => (b ? { ...b, step: text, pct: Math.max(b.pct, pct) } : b))
  const [hoverNow, setHover] = useState('')
  const [hoverRelNow, setHoverRel] = useState('')
  const [mode, setMode] = useState<ColMode>('all')
  const [labels, setLabels] = useState(true)
  const [panel, setPanel] = useState(true)
  const [find, setFind] = useState('')
  const [menu, setMenu] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const load = async () => {
    setError(''); setStatus('Loading tables…')
    setBusy({ label: 'Loading the diagram', step: 'Listing tables', pct: 0.03, load: true })
    try {
      const all = (await window.db.listTables(connId)).filter((t) => t.type !== 'view')
      setSchemas([...new Set(all.map((t) => t.schema ?? ''))].filter(Boolean))
      const picked = all.filter((t) => !schema || t.schema === schema).slice(0, MAX_TABLES)
      let done = 0
      const structs = await pool(picked, 6, async (t) => {
        const s = await window.db.getStructure(connId, t).catch(() => ({ columns: [], indexes: [], foreignKeys: [], triggers: [] }))
        ++done
        setStatus(`Reading structure ${done} / ${picked.length}…`)
        if (picked.length > 20) setBusy((b) => b && { ...b, step: `Reading table ${done.toLocaleString()} of ${picked.length.toLocaleString()}`, pct: 0.05 + 0.85 * done / picked.length })
        return s
      })
      setBusy((b) => b && { ...b, step: 'Laying out tables and relationships', pct: 0.93 })
      await new Promise((r) => setTimeout(r, 30))
      const list = picked.map((t, i) => ({ t, s: structs[i], key: keyOf(t), w: widthOf(t, structs[i]) }))
      setBoxes(list)
      let p = layout(list, mode)
      try {
        const saved = JSON.parse(localStorage.getItem(layoutKey()) ?? 'null')
        if (saved?.pos) p = { ...p, ...Object.fromEntries(Object.entries(saved.pos as Record<string, { x: number; y: number }>).filter(([k]) => p[k])) }
        setBend(saved?.bend ?? {})
      } catch { setBend({}) }
      setPos(p)
      requestAnimationFrame(() => fit(list, p, mode))
      setStatus(all.length > picked.length && !schema ? `Showing the first ${MAX_TABLES} of ${all.length} tables; pick a schema to narrow it down.` : '')
    } catch (e) { setError(errMsg(e)); setStatus('') } finally { setTimeout(() => setBusy((b) => (b?.load ? null : b)), 120) }
  }
  useEffect(() => { load() }, [connId, schema]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!boxes.length) return
    const t = setTimeout(() => { try { localStorage.setItem(layoutKey(), JSON.stringify({ pos, bend })) } catch { /* storage full */ } }, 400)
    return () => clearTimeout(t)
  }, [pos, bend]) // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = useMemo(() => new Map(boxes.map((b) => [b.key, b])), [boxes])

  /** Every foreign key, with whether it is one-to-one (key columns unique) and optional (nullable) */
  const rels: Rel[] = useMemo(() => boxes.flatMap((b) => b.s.foreignKeys.map((fk, i) => {
    const to = byKey.get(keyOf({ schema: fk.refSchema ?? b.t.schema, name: fk.refTable }))
    const pk = b.s.columns.filter((c) => c.primaryKey).map((c) => c.name)
    const one = (pk.length > 0 && sameSet(fk.columns, pk)) || b.s.indexes.some((ix) => (ix.unique || ix.primary) && sameSet(ix.columns, fk.columns))
    const optional = fk.columns.some((n) => b.s.columns.find((c) => c.name === n)?.nullable)
    return { id: `${b.key}#${fk.name || i}`, from: b, to, fk, one, optional }
  })), [boxes, byKey])

  const fkCols = (b: Box) => new Set(b.s.foreignKeys.flatMap((f) => f.columns))
  const uniqueCols = (b: Box) => new Set(b.s.indexes.filter((ix) => ix.unique && !ix.primary && ix.columns.length === 1).flatMap((ix) => ix.columns))
  const rowsOf = (b: Box, m = mode): ColumnInfo[] => {
    if (m === 'names') return []
    if (m === 'keys') { const f = fkCols(b); return b.s.columns.filter((c) => c.primaryKey || f.has(c.name)) }
    return b.s.columns
  }
  const height = (b: Box, m = mode) => HEAD_H + rowsOf(b, m).length * ROW_H + (m === 'names' ? 0 : 6)

  /** Most-linked tables first, neighbours kept together; columns as wide as their widest table. */
  function layout(list: Box[], m: ColMode) {
    const deg = new Map(list.map((b) => [b.key, 0]))
    const links = new Map(list.map((b) => [b.key, new Set<string>()]))
    for (const b of list) for (const fk of b.s.foreignKeys) {
      const to = keyOf({ schema: fk.refSchema ?? b.t.schema, name: fk.refTable })
      if (!deg.has(to) || to === b.key) continue
      deg.set(b.key, deg.get(b.key)! + 1); deg.set(to, deg.get(to)! + 1)
      links.get(b.key)!.add(to); links.get(to)!.add(b.key)
    }
    const order: string[] = [], seen = new Set<string>()
    for (const start of [...list].sort((a, b) => deg.get(b.key)! - deg.get(a.key)!).map((b) => b.key)) {
      if (seen.has(start)) continue
      const q = [start]; seen.add(start)
      while (q.length) {
        const k = q.shift()!; order.push(k)
        for (const n of [...links.get(k)!].sort((a, b) => deg.get(b)! - deg.get(a)!)) if (!seen.has(n)) { seen.add(n); q.push(n) }
      }
    }
    const map = new Map(list.map((b) => [b.key, b]))
    const cols = Math.max(1, Math.ceil(Math.sqrt(order.length * 1.3)))
    const colW = Array.from({ length: cols }, (_, c) => Math.max(MIN_W, ...order.filter((_, i) => i % cols === c).map((k) => map.get(k)!.w)))
    const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, w) => a + w + GAP_X, 0))
    const out: Record<string, { x: number; y: number }> = {}
    let y = 0
    for (let r = 0; r * cols < order.length; r++) {
      const row = order.slice(r * cols, r * cols + cols)
      row.forEach((k, c) => { out[k] = { x: colX[c], y } })
      y += Math.max(...row.map((k) => height(map.get(k)!, m))) + GAP_Y
    }
    return out
  }

  const bounds = (list = boxes, p = pos, m = mode) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const b of list) { const q = p[b.key]; if (!q) continue; x1 = Math.min(x1, q.x); y1 = Math.min(y1, q.y); x2 = Math.max(x2, q.x + b.w); y2 = Math.max(y2, q.y + height(b, m)) }
    return x1 === Infinity ? { x: 0, y: 0, w: 100, h: 100 } : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }
  function fit(list = boxes, p = pos, m = mode) {
    const el = svgRef.current
    if (!el || !list.length) return
    const r = el.getBoundingClientRect(), b = bounds(list, p, m)
    const k = Math.min(1.2, Math.max(0.12, Math.min((r.width - 40) / b.w, (r.height - 40) / b.h)))
    setView({ k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k })
  }
  const zoom = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2
    setView((v) => { const k = Math.min(2.5, Math.max(0.12, v.k * f)); return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k } })
  }
  const focus = (key: string) => {
    const b = byKey.get(key), p = pos[key], el = svgRef.current
    if (!b || !p || !el) return
    const r = el.getBoundingClientRect(), k = Math.max(view.k, 0.9)
    setView({ k, x: r.width / 2 - (p.x + b.w / 2) * k, y: r.height / 2 - (p.y + height(b) / 2) * k })
    setHover(key)
  }
  const changeMode = (m: ColMode) => { setMode(m); const p = layout(boxes, m); setPos(p); setBend({}); requestAnimationFrame(() => fit(boxes, p, m)) }

  // ---- pan, zoom, drag ----
  const drag = useRef<{ kind: 'pan' | 'box' | 'rel'; key?: string; sx: number; sy: number; ox: number; oy: number } | null>(null)
  const onRelDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); setMenu(false)
    const b = bend[id] ?? { dx: 0, dy: 0 }
    drag.current = { kind: 'rel', key: id, sx: e.clientX, sy: e.clientY, ox: b.dx, oy: b.dy }
  }
  const onDown = (e: React.MouseEvent, key?: string) => {
    e.stopPropagation(); setMenu(false)
    const p = key ? pos[key] : view
    drag.current = { kind: key ? 'box' : 'pan', key, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y }
  }
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    else if (d.kind === 'rel') setBend((b) => ({ ...b, [d.key!]: { dx: d.ox + dx / view.k, dy: d.oy + dy / view.k } }))
    else setPos((p) => ({ ...p, [d.key!]: { x: d.ox + dx / view.k, y: d.oy + dy / view.k } }))
  }
  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const k = Math.min(2.5, Math.max(0.12, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    setView((v) => ({ k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }))
  }

  /** y of a column's row centre, or the header centre when the column isn't shown */
  const rowY = (b: Box, col: string) => {
    const i = rowsOf(b).findIndex((c) => c.name.toLowerCase() === col.toLowerCase())
    return i < 0 ? HEAD_H / 2 : HEAD_H + i * ROW_H + ROW_H / 2
  }

  // Hover highlighting is deferred so moving the mouse over a big diagram never blocks the screen
  const hover = useDeferredValue(hoverNow), hoverRel = useDeferredValue(hoverRelNow)
  const q = find.trim().toLowerCase()
  // Only draw what is near the screen, and skip column text when zoomed too far out to read it.
  // The visible area is rounded to coarse blocks so panning inside a block needs no redraw.
  const [full, setFull] = useState(false) // exports need every table drawn
  const big = boxes.length > 40
  const detail = full || !big || view.k >= 0.4
  const sw = svgRef.current?.clientWidth || 1600, sh = svgRef.current?.clientHeight || 1000
  const ww = sw / view.k, wh = sh / view.k
  const grid = 2 ** Math.ceil(Math.log2(Math.max(ww, wh) / 2))
  const area = full || !big ? null : {
    x1: Math.floor((-view.x / view.k - ww * 0.5) / grid) * grid, y1: Math.floor((-view.y / view.k - wh * 0.5) / grid) * grid,
    x2: Math.ceil((-view.x / view.k + ww * 1.5) / grid) * grid, y2: Math.ceil((-view.y / view.k + wh * 1.5) / grid) * grid
  }
  const areaKey = area ? `${area.x1},${area.y1},${area.x2},${area.y2}` : 'all'
  const scene = useMemo(() => {
  // ---- relationship lines with crow's-foot ends ----
  const relEls = rels.filter((r) => r.to && pos[r.from.key] && pos[r.to.key]).map((r) => {
    const a = pos[r.from.key], t = pos[r.to!.key], A = r.from, T = r.to!
    const self = A === T
    const y1 = a.y + rowY(A, r.fk.columns[0] ?? ''), y2 = t.y + rowY(T, r.fk.refColumns[0] ?? '')
    const right = self || t.x + T.w / 2 > a.x + A.w / 2
    const x1 = right ? a.x + A.w : a.x
    const x2 = self ? a.x + A.w : right ? t.x : t.x + T.w
    const s1 = right ? 1 : -1, s2 = self ? 1 : right ? -1 : 1
    const curve = self ? 70 : Math.max(50, Math.abs(x2 - x1) / 2)
    const c1x = x1 + s1 * curve, c2x = x2 + s2 * curve
    if (area && (Math.max(x1, x2) + curve < area.x1 || Math.min(x1, x2) - curve > area.x2 || Math.max(y1, y2) < area.y1 || Math.min(y1, y2) > area.y2)) return null
    const on = hoverRel === r.id || hover === A.key || hover === T.key
    const dim = (hover || hoverRel) && !on
    // Bezier midpoint for the label
    const off = bend[r.id]
    const mx = (x1 + 3 * c1x + 3 * c2x + x2) / 8 + (off?.dx ?? 0), my = (y1 + 3 * y1 + 3 * y2 + y2) / 8 + (off?.dy ?? 0)
    // A moved label pulls the line through it: two curves meeting smoothly at the label
    const hx = Math.max(40, Math.abs(x2 - x1) / 4) * (x2 >= x1 ? 1 : -1)
    const d = off
      ? `M ${x1} ${y1} C ${x1 + s1 * 50} ${y1}, ${mx - hx} ${my}, ${mx} ${my} C ${mx + hx} ${my}, ${x2 + s2 * 50} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`
    const label = `${r.fk.columns.join(', ')} → ${r.fk.refColumns.join(', ')}`
    const card = r.one ? '1 : 1' : 'N : 1'
    const lw = Math.max(label.length, card.length + 6) * 6.2 + 14
    // Child end (many or one, optional circle); parent end (exactly one)
    const e1 = x1 + s1 * 14, e2 = x2 + s2 * 14
    return (
      <g key={r.id} className={`er-rel ${on ? 'on' : ''} ${dim ? 'dim' : ''}`} onMouseEnter={() => setHoverRel(r.id)} onMouseLeave={() => setHoverRel('')}>
        <path d={d} className="er-hit" onMouseDown={(e) => onRelDown(e, r.id)} />
        <path d={d} className={`er-line ${r.optional ? 'opt' : ''}`} />
        {r.one
          ? <path d={`M ${x1 + s1 * 8} ${y1 - 6} V ${y1 + 6}`} className="er-end" />
          : <path d={`M ${e1} ${y1} L ${x1} ${y1 - 7} M ${e1} ${y1} L ${x1} ${y1} M ${e1} ${y1} L ${x1} ${y1 + 7}`} className="er-end" />}
        {r.optional
          ? <circle cx={x1 + s1 * 20} cy={y1} r={4} className="er-ring" />
          : <path d={`M ${x1 + s1 * 18} ${y1 - 6} V ${y1 + 6}`} className="er-end" />}
        <path d={`M ${x2 + s2 * 7} ${y2 - 6} V ${y2 + 6} M ${x2 + s2 * 12} ${y2 - 6} V ${y2 + 6}`} className="er-end" />
        {((labels && detail) || on || off) && (
          <g transform={`translate(${mx} ${my})`} className="er-label" onMouseDown={(e) => onRelDown(e, r.id)} onDoubleClick={(e) => { e.stopPropagation(); setBend((b) => { const n = { ...b }; delete n[r.id]; return n }) }}>
            <rect x={-lw / 2} y={-17} width={lw} height={34} rx={6} />
            <text y={-3} textAnchor="middle" className="er-label-name">{label}</text>
            <text y={11} textAnchor="middle" className="er-label-card">{card}{r.optional ? ' · optional' : ''}</text>
            <title>{`${fullName(A.t)}.${r.fk.columns.join(', ')} → ${fullName(T.t)}.${r.fk.refColumns.join(', ')}${r.fk.name ? `\nConstraint: ${r.fk.name}` : ''}\n${r.one ? 'One' : 'Many'} ${A.t.name} to one ${T.t.name}`}</title>
          </g>
        )}
      </g>
    )
  })

  // Columns to highlight while a relationship is hovered
  const hot = new Set<string>()
  for (const r of rels) if (r.to && (r.id === hoverRel)) {
    r.fk.columns.forEach((c) => hot.add(`${r.from.key}|${c.toLowerCase()}`))
    r.fk.refColumns.forEach((c) => hot.add(`${r.to!.key}|${c.toLowerCase()}`))
  }
  // Tables that stay bright while something is hovered (worked out once, not per table)
  const lit = new Set<string>()
  if (hover) { lit.add(hover); for (const r of rels) if (r.to && (r.from.key === hover || r.to.key === hover)) { lit.add(r.from.key); lit.add(r.to.key) } }
  for (const h of hot) lit.add(h.slice(0, h.lastIndexOf('|')))
  const anyHover = !!(hover || hoverRel)
  return <>{relEls}
{boxes.map((b) => {
              const p = pos[b.key]
              if (!p) return null
              if (area && (p.x > area.x2 || p.x + b.w < area.x1 || p.y > area.y2 || p.y + height(b) < area.y1)) return null
              const f = fkCols(b), u = uniqueCols(b)
              const rows = rowsOf(b)
              const match = q && fullName(b.t).toLowerCase().includes(q)
              const nameMax = Math.floor((b.w - PAD_X * 2 - BADGE_W - 60) / NAME_CH)
              return (
                <g key={b.key} transform={`translate(${p.x} ${p.y})`} className={`er-box ${hover === b.key ? 'on' : ''} ${match ? 'match' : ''} ${anyHover && !lit.has(b.key) ? 'dim' : ''}`}
                  onMouseDown={(e) => onDown(e, b.key)} onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover('')}
                  onDoubleClick={() => onOpenTable(b.t)}>
                  <rect width={b.w} height={height(b)} rx={8} className="er-body" />
                  <path d={`M 0 8 Q 0 0 8 0 H ${b.w - 8} Q ${b.w} 0 ${b.w} 8 V ${HEAD_H} H 0 Z`} className="er-head" />
                  <text x={PAD_X} y={22} className="er-title">{b.t.schema && <tspan className="er-schema">{b.t.schema}.</tspan>}{b.t.name}</text>
                  <text x={b.w - PAD_X} y={22} textAnchor="end" className="er-count">{b.s.columns.length}</text>
                  <title>{`${fullName(b.t)} · ${b.s.columns.length} columns · double-click to open`}</title>
                  {detail && rows.map((c, i) => {
                    const isFk = f.has(c.name)
                    const tag = c.primaryKey ? 'PK' : isFk ? 'FK' : u.has(c.name) ? 'UQ' : ''
                    const isHot = hot.has(`${b.key}|${c.name.toLowerCase()}`)
                    return (
                      <g key={c.name} transform={`translate(0 ${HEAD_H + i * ROW_H})`} className={isHot ? 'er-row hot' : 'er-row'}>
                        {i % 2 === 1 && <rect x={1} width={b.w - 2} height={ROW_H} className="er-stripe" />}
                        {isHot && <rect x={1} width={b.w - 2} height={ROW_H} className="er-hotbg" />}
                        {tag && <><rect x={PAD_X - 2} y={4} width={22} height={14} rx={3} className={`er-tag ${tag.toLowerCase()}`} /><text x={PAD_X + 9} y={14.5} textAnchor="middle" className="er-tag-text">{tag}</text></>}
                        <text x={PAD_X + BADGE_W} y={15} className={`er-col ${c.primaryKey ? 'pk' : ''} ${c.nullable ? 'null' : ''}`}>{c.name.length > nameMax ? c.name.slice(0, nameMax - 1) + '…' : c.name}{!c.nullable && !c.primaryKey ? <tspan className="er-req"> *</tspan> : null}</text>
                        <text x={b.w - PAD_X} y={15} textAnchor="end" className="er-type">{c.dataType.length > 22 ? c.dataType.slice(0, 21) + '…' : c.dataType}{c.nullable ? '?' : ''}</text>
                        <title>{`${c.name} ${c.dataType}${c.nullable ? ' NULL' : ' NOT NULL'}${c.primaryKey ? ' · primary key' : ''}${isFk ? ' · foreign key' : ''}${c.defaultValue != null ? ` · default ${c.defaultValue}` : ''}${c.autoIncrement ? ' · auto increment' : ''}`}</title>
                      </g>
                    )
                  })}
                </g>
              )
            })}</>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, rels, pos, bend, hover, hoverRel, labels, q, mode, onOpenTable, areaKey, detail])

  // ---- export ----
  const baseName = () => `er-diagram${schema ? '-' + schema : ''}`
  /** Stand-alone SVG with real colours (no CSS variables) cropped to the tables */
  const exportSvg = async () => {
    const src = svgRef.current!
    const clone = src.cloneNode(true) as SVGSVGElement
    const a = [src, ...src.querySelectorAll('*')] as Element[]
    const b = [clone, ...clone.querySelectorAll('*')] as Element[]
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-weight', 'font-family', 'font-style']
    // Copy real colours in batches so the window stays responsive (500+ tables = tens of thousands of shapes)
    const BATCH = 1200
    const seen = new Map<Element, Record<string, string>>()
    for (let i = 0; i < a.length; i += BATCH) {
      if (cancelRef.current) throw new Cancelled()
      for (let j = i; j < Math.min(a.length, i + BATCH); j++) {
        const cs = getComputedStyle(a[j])
        const isText = a[j].tagName === 'text' || a[j].tagName === 'tspan'
        const mine: Record<string, string> = {}
        for (const p of props) mine[p] = cs.getPropertyValue(p)
        seen.set(a[j], mine)
        const parent = j ? seen.get(a[j].parentElement!) : undefined
        // Text gets its fonts written out; inherited paint values only when they differ from the parent's; opacity only when not 1
        const css = props.filter((p) => (p.startsWith('font') ? isText : p === 'opacity' ? mine[p] !== '1' : !parent || parent[p] !== mine[p]))
          .map((p) => `${p}:${mine[p]}`).join(';')
        if (css) b[j].setAttribute('style', css); else b[j].removeAttribute('style')
        b[j].removeAttribute('class')
      }
      step('Copying colours and fonts', Math.min(a.length, i + BATCH) / a.length * 0.6)
      await new Promise((r) => setTimeout(r, 0))
    }
    clone.querySelectorAll('[data-noexport]').forEach((n) => n.remove())
    const pad = 30, bb = bounds()
    const g = clone.querySelector('g[data-root]')!
    g.setAttribute('transform', `translate(${pad - bb.x} ${pad - bb.y})`)
    const W = Math.ceil(bb.w + pad * 2), H = Math.ceil(bb.h + pad * 2)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(W)); clone.setAttribute('height', String(H)); clone.setAttribute('viewBox', `0 0 ${W} ${H}`)
    clone.setAttribute('style', `background:${getComputedStyle(src).backgroundColor}`)
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', getComputedStyle(src).backgroundColor)
    clone.insertBefore(bg, clone.firstChild)
    return { svg: new XMLSerializer().serializeToString(clone), W, H }
  }
  const toPng = async (scale = 2) => {
    const { svg, W, H } = await exportSvg()
    step('Drawing the image', 0.7)
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) // the page only allows data: images
    await img.decode()
    if (cancelRef.current) throw new Cancelled()
    // A canvas that can't get enough memory comes back blank (transparent) without any error.
    // Stay well inside what any PC can hold (≈40M pixels, 160 MB), and check the result,
    // shrinking further if the drawing didn't take.
    let k = Math.min(scale, 16000 / Math.max(W, H), Math.sqrt(40e6 / (W * H)))
    for (let tries = 0; ; tries++) {
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k))
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.scale(k, k); ctx.drawImage(img, 0, 0)
        // The background is solid, so every corner and the middle must be opaque
        const pts = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1], [c.width >> 1, c.height >> 1]]
        if (pts.every(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] > 0)) { step('Encoding PNG', 0.85); await new Promise((r) => setTimeout(r, 0)); return c }
      }
      c.width = c.height = 0 // free the memory before trying smaller
      if (tries >= 4) throw new Error('The diagram is too large to draw as an image on this computer. Try PDF or SVG instead.')
      k /= 1.5
    }
  }
  const say = (p: string | null) => { if (p) setStatus(`Saved to ${p}`) }
  /** Browser-style download; used when the app's file bridge is older than this page (e.g. dev reload) */
  const download = (blob: Blob, file: string) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    setStatus(`Saving ${file}…`)
  }
  const saveText = async (text: string, filter: string, ext: string, mime = 'text/plain') => {
    if (typeof window.db.saveTextFile === 'function') say(await window.db.saveTextFile(text, { name: baseName(), filter, ext }))
    else download(new Blob([text], { type: mime }), `${baseName()}.${ext}`)
  }
  const run = async (label: string, f: () => Promise<void>) => {
    setMenu(false); setError(''); setStatus(''); setHover(''); setHoverRel('')
    cancelRef.current = false
    setBusy({ label: `Exporting ${label}`, step: 'Getting ready', pct: 0.02 })
    setFull(true) // the screen only draws nearby tables; the file needs all of them
    await new Promise((r) => setTimeout(r, 80)) // let the overlay paint first
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try { await f() } catch (e) { if (e instanceof Cancelled) setStatus('Export cancelled'); else setError(`Export failed: ${errMsg(e)}`) } finally { setBusy(null); setFull(false) }
  }
  const pngBase64 = async (c: HTMLCanvasElement) => {
    const blob = await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('The image is too large to encode'))), 'image/png'))
    step('Saving the file', 0.95)
    return await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob) })
  }

  const ident = (s: string) => s.replace(/[^\w]/g, '_')
  const mermaid = () => [
    'erDiagram',
    ...boxes.map((b) => `  ${ident(fullName(b.t))} {\n${b.s.columns.map((c) => `    ${ident(c.dataType || 'unknown') || 'unknown'} ${ident(c.name)}${c.primaryKey ? ' PK' : fkCols(b).has(c.name) ? ' FK' : ''}${c.nullable ? '' : ' "not null"'}`).join('\n')}\n  }`),
    ...rels.filter((r) => r.to).map((r) => `  ${ident(fullName(r.to!.t))} ||--${r.one ? (r.optional ? 'o|' : '||') : (r.optional ? 'o{' : '|{')} ${ident(fullName(r.from.t))} : "${r.fk.columns.join(', ')}"`)
  ].join('\n') + '\n'
  const dbml = () => [
    ...boxes.map((b) => `Table ${b.t.schema ? `"${b.t.schema}"."${b.t.name}"` : `"${b.t.name}"`} {\n${b.s.columns.map((c) => {
      const o = [c.primaryKey && 'pk', !c.nullable && !c.primaryKey && 'not null', c.autoIncrement && 'increment', uniqueCols(b).has(c.name) && 'unique', c.defaultValue != null && `default: \`${c.defaultValue}\``].filter(Boolean)
      return `  "${c.name}" "${c.dataType}"${o.length ? ` [${o.join(', ')}]` : ''}`
    }).join('\n')}\n}\n`),
    ...rels.map((r) => {
      const ref = r.to ? (r.to.t.schema ? `"${r.to.t.schema}"."${r.to.t.name}"` : `"${r.to.t.name}"`) : `"${r.fk.refTable}"`
      const own = r.from.t.schema ? `"${r.from.t.schema}"."${r.from.t.name}"` : `"${r.from.t.name}"`
      return `Ref${r.fk.name ? ` "${r.fk.name}"` : ''}: ${own}.(${r.fk.columns.map((c) => `"${c}"`).join(', ')}) ${r.one ? '-' : '>'} ${ref}.(${r.fk.refColumns.map((c) => `"${c}"`).join(', ')})`
    })
  ].join('\n') + '\n'
  const plantuml = () => [
    '@startuml', 'hide circle', 'skinparam linetype ortho', '',
    ...boxes.map((b) => `entity "${fullName(b.t)}" as ${ident(fullName(b.t))} {\n${b.s.columns.filter((c) => c.primaryKey).map((c) => `  * ${c.name} : ${c.dataType} <<PK>>`).join('\n')}\n  --\n${b.s.columns.filter((c) => !c.primaryKey).map((c) => `  ${c.nullable ? '' : '* '}${c.name} : ${c.dataType}${fkCols(b).has(c.name) ? ' <<FK>>' : ''}`).join('\n')}\n}\n`),
    ...rels.filter((r) => r.to).map((r) => `${ident(fullName(r.from.t))} ${r.one ? (r.optional ? '|o' : '||') : (r.optional ? '}o' : '}|')}--|| ${ident(fullName(r.to!.t))} : ${r.fk.columns.join(', ')}`),
    '@enduml'
  ].join('\n') + '\n'

  const EXPORTS: { label: string; hint: string; go: () => Promise<void> }[] = [
    { label: 'PNG image', hint: 'High resolution, for documents and chat', go: async () => { const c = await toPng(2); if (typeof window.db.saveBinaryFile === 'function') { const b64 = await pngBase64(c); step('Saving the file', 0.97); say(await window.db.saveBinaryFile(b64, { name: baseName(), filter: 'PNG image', ext: 'png' })) } else download(await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png')), `${baseName()}.png`) } },
    { label: 'SVG vector', hint: 'Sharp at any size, editable', go: async () => { const { svg } = await exportSvg(); step('Saving the file', 0.9); await saveText(svg, 'SVG image', 'svg', 'image/svg+xml') } },
    { label: 'PDF', hint: 'One page, vector', go: async () => { const { svg, W, H } = await exportSvg(); step('Building the PDF', 0.8); if (typeof window.db.saveSvgAsPdf !== 'function') throw new Error('PDF export needs Qubase to be restarted once after this update (close the window and start it again).'); say(await window.db.saveSvgAsPdf(svg, { name: baseName(), width: W, height: H })) } },
    { label: 'Mermaid', hint: 'For GitHub, GitLab, Notion, Markdown', go: () => saveText(mermaid(), 'Mermaid', 'mmd') },
    { label: 'DBML', hint: 'For dbdiagram.io / dbdocs', go: () => saveText(dbml(), 'DBML', 'dbml') },
    { label: 'PlantUML', hint: 'For PlantUML and Confluence', go: () => saveText(plantuml(), 'PlantUML', 'puml') },
    { label: 'Copy as image', hint: 'PNG to the clipboard', go: async () => { const c = await toPng(2); const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); setStatus('Diagram copied as an image') } },
    { label: 'Copy as Mermaid', hint: 'Text to the clipboard', go: async () => { await navigator.clipboard.writeText(mermaid()); setStatus('Mermaid copied') } }
  ]

  const relCount = rels.filter((r) => r.to).length
  const outside = rels.filter((r) => !r.to)

  return (
    <div className="er-view" aria-busy={!!busy}>
      <div className="toolbar er-toolbar">
        <div className="crumb"><strong>ER diagram</strong> <span className="muted">· {boxes.length} tables · {relCount} relationships · drag tables or line labels to move them</span></div>
        <div className="spacer" />
        <input className="er-find" placeholder="Find table…" value={find} onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { const b = boxes.find((x) => fullName(x.t).toLowerCase().includes(q)); if (b) focus(b.key) } }} />
        {schemas.length > 1 && (
          <select value={schema} onChange={(e) => setSchema(e.target.value)} title="Schema">
            <option value="">All schemas</option>
            {schemas.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <select value={mode} onChange={(e) => changeMode(e.target.value as ColMode)} title="What each table shows">
          <option value="all">All columns</option>
          <option value="keys">Key columns only</option>
          <option value="names">Table names only</option>
        </select>
        <label className="check small-text"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels</label>
        <div className="er-zoom">
          <button className="btn btn-sm" onClick={() => zoom(1 / 1.2)} title="Zoom out">−</button>
          <span className="small-text">{Math.round(view.k * 100)}%</span>
          <button className="btn btn-sm" onClick={() => zoom(1.2)} title="Zoom in">+</button>
          <button className="btn btn-sm" onClick={() => fit()} title="Fit all tables on screen">Fit</button>
        </div>
        <button className="btn btn-sm" title="Put tables back in the automatic layout and straighten all lines" onClick={() => { const p = layout(boxes, mode); setPos(p); setBend({}); requestAnimationFrame(() => fit(boxes, p)) }}>Rearrange</button>
        <button className={`btn btn-sm ${panel ? 'btn-on' : ''}`} onClick={() => setPanel((v) => !v)}>Relationships</button>
        <div className="menu-wrap">
          <button className="btn btn-sm btn-primary" onClick={() => setMenu((m) => !m)} disabled={!boxes.length}>Export ▾</button>
          {menu && (
            <div className="menu er-export">
              {EXPORTS.map((x) => <button key={x.label} onClick={() => run(x.label, x.go)}><strong>{x.label}</strong><span className="muted small-text">{x.hint}</span></button>)}
            </div>
          )}
        </div>
        <button className="icon-btn" title="Reload" onClick={load}><IconRefresh /></button>
      </div>
      {status && <div className="notice">{status}</div>}
      {error && <div className="notice error">{error}</div>}
      {busy && (
        <div className="er-busy" role="status" aria-live="polite">
          <div className="er-busy-card">
            <div className="er-busy-anim" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            <strong>{busy.label}</strong>
            <span className="muted small-text">{busy.step}…{!busy.load && ` ${boxes.length.toLocaleString()} tables, ${rels.length.toLocaleString()} relationships`}</span>
            <div className="er-busy-bar"><i style={{ width: `${Math.round(busy.pct * 100)}%` }} /></div>
            <span className="er-busy-pct">{Math.round(busy.pct * 100)}%</span>
            {!busy.load && <button className="btn btn-sm" onClick={() => { cancelRef.current = true; step('Cancelling', busy.pct) }}>Cancel</button>}
          </div>
        </div>
      )}
      <div className="er-main">
        <svg ref={svgRef} className="er-svg" onMouseDown={(e) => onDown(e)} onMouseMove={onMove} onMouseUp={() => { drag.current = null }} onMouseLeave={() => { drag.current = null }} onWheel={onWheel}>
          <g data-root="" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {scene}
          </g>
        </svg>
        <div className="er-legend" data-noexport="">
          <span><b className="er-tag-k pk">PK</b> primary key</span>
          <span><b className="er-tag-k fk">FK</b> foreign key</span>
          <span><b className="er-tag-k uq">UQ</b> unique</span>
          <span><b>*</b> required · <b>?</b> nullable</span>
          <span><svg width="34" height="14"><path d="M2 7 H32 M10 7 L2 1 M10 7 L2 13 M30 1 V13 M26 1 V13" stroke="currentColor" fill="none" /></svg> many → one</span>
          <span><svg width="34" height="14"><path d="M2 7 H32" stroke="currentColor" strokeDasharray="4 3" fill="none" /><circle cx="12" cy="7" r="3.5" stroke="currentColor" fill="var(--bg)" /></svg> optional</span>
        </div>
        {panel && (
          <aside className="er-panel">
            <div className="er-panel-head">Relationships <span className="muted">{rels.length}</span></div>
            {rels.length === 0 && <p className="muted small-text pad">No foreign keys found in these tables.</p>}
            <ul>
              {rels.filter((r) => r.to).map((r) => (
                <li key={r.id} className={hoverRelNow === r.id ? 'on' : ''} onMouseEnter={() => setHoverRel(r.id)} onMouseLeave={() => setHoverRel('')} onClick={() => focus(r.from.key)}>
                  <div className="er-rel-line"><strong>{r.from.t.name}</strong><span className="er-card">{r.one ? '1 : 1' : 'N : 1'}</span><strong>{r.to!.t.name}</strong></div>
                  <div className="muted small-text mono">{r.fk.columns.join(', ')} → {r.fk.refColumns.join(', ')}</div>
                  {r.fk.name && <div className="muted small-text">{r.fk.name}{r.optional ? ' · optional' : ''}</div>}
                </li>
              ))}
              {outside.map((r) => (
                <li key={r.id} className="outside" onClick={() => focus(r.from.key)}>
                  <div className="er-rel-line"><strong>{r.from.t.name}</strong><span className="er-card">→</span><strong>{r.fk.refSchema ? r.fk.refSchema + '.' : ''}{r.fk.refTable}</strong></div>
                  <div className="muted small-text">Points to a table outside this diagram</div>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}
