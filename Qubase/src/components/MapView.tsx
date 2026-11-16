import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as RPointerEvent } from 'react'
import type { QueryResult } from '../../shared/types'
import { cellText } from '../util'

// Draws points, lines and shapes from a result on a plain longitude / latitude plot. No map tiles are
// loaded, so nothing leaves the computer. Reads GeoJSON, WKT (POINT, LINESTRING, POLYGON, MULTI…) and lat / lng column pairs.

type Pt = [number, number]
type Shape = { kind: 'point' | 'line' | 'poly'; coords: Pt[]; row: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromGeoJson(g: any, row: number, out: Shape[]): void {
  if (!g || typeof g !== 'object') return
  if (g.type === 'Feature') return fromGeoJson(g.geometry, row, out)
  if (g.type === 'FeatureCollection') { g.features?.forEach((f: any) => fromGeoJson(f, row, out)); return }
  if (g.type === 'GeometryCollection') { g.geometries?.forEach((x: any) => fromGeoJson(x, row, out)); return }
  const c = g.coordinates
  if (!Array.isArray(c)) return
  if (g.type === 'Point') out.push({ kind: 'point', coords: [c as Pt], row })
  else if (g.type === 'MultiPoint') c.forEach((p: Pt) => out.push({ kind: 'point', coords: [p], row }))
  else if (g.type === 'LineString') out.push({ kind: 'line', coords: c, row })
  else if (g.type === 'MultiLineString') c.forEach((l: Pt[]) => out.push({ kind: 'line', coords: l, row }))
  else if (g.type === 'Polygon') c.forEach((r: Pt[]) => out.push({ kind: 'poly', coords: r, row }))
  else if (g.type === 'MultiPolygon') c.forEach((p: Pt[][]) => p.forEach((r) => out.push({ kind: 'poly', coords: r, row })))
}

const WKT = /^\s*(?:SRID=\d+;)?\s*(?:MULTI)?(POINT|LINESTRING|POLYGON)\s*(?:ZM|Z|M)?\s*\(([\s\S]*)\)\s*$/i
const parsePts = (s: string): Pt[] => s.replace(/[()]/g, '').split(',')
  .map((p) => p.trim().split(/\s+/).map(Number))
  .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  .map((p) => [p[0], p[1]] as Pt)

function fromWkt(t: string, row: number, out: Shape[]) {
  const m = WKT.exec(t)
  if (!m) return
  const type = m[1].toUpperCase()
  if (type === 'POINT') { parsePts(m[2]).forEach((p) => out.push({ kind: 'point', coords: [p], row })); return }
  // Innermost (...) groups are the rings / lines; a plain LINESTRING has none
  const groups = m[2].match(/\([^()]*\)/g) ?? [m[2]]
  for (const g of groups) { const c = parsePts(g); if (c.length) out.push({ kind: type === 'LINESTRING' ? 'line' : 'poly', coords: c, row }) }
}

const LAT = /^(lat|latitude)$/i, LNG = /^(lon|lng|long|longitude)$/i

export function findShapes(result: QueryResult, order: number[]): Shape[] {
  const out: Shape[] = []
  const lat = result.columns.find((c) => LAT.test(c)), lng = result.columns.find((c) => LNG.test(c))
  for (const i of order.slice(0, 20000)) {
    const r = result.rows[i]
    if (lat && lng && r[lat] !== null && r[lng] !== null && Number.isFinite(Number(r[lat])) && Number.isFinite(Number(r[lng]))) {
      out.push({ kind: 'point', coords: [[Number(r[lng]), Number(r[lat])]], row: i })
      continue
    }
    for (const c of result.columns) {
      const v = r[c]
      if (v && typeof v === 'object' && 'type' in (v as object)) { fromGeoJson(v, i, out); continue }
      if (typeof v !== 'string' || v.length < 8) continue
      if (v[0] === '{' && v.includes('"coordinates"')) { try { fromGeoJson(JSON.parse(v), i, out) } catch { /* not JSON */ } }
      else fromWkt(v, i, out)
    }
  }
  return out
}

// ---------- Offline world map (Natural Earth borders from world-atlas, bundled with the app) ----------

const W = 1000, H = 500 // equirectangular: longitude -180..180 → 0..1000, latitude 90..-90 → 0..500
const sx = (lng: number) => ((lng + 180) / 360) * W
const sy = (lat: number) => ((90 - lat) / 180) * H
/** SVG path; a ring that crosses the 180° meridian (Russia, Fiji…) is kept continuous instead of jumping across the map */
const toPath = (c: Pt[], close: boolean) => {
  let shift = 0, prev = c[0]?.[0] ?? 0
  return c.map(([x, y], i) => {
    if (x - prev > 180) shift -= 360; else if (prev - x > 180) shift += 360
    prev = x
    return `${i ? 'L' : 'M'}${sx(x + shift).toFixed(2)},${sy(y).toFixed(2)}`
  }).join('') + (close ? 'Z' : '')
}

type Country = { name: string; d: string }
let worldCache: Promise<Country[]> | null = null
/** Country outlines as SVG paths; loaded on first use so the main bundle stays small */
function loadWorld() {
  worldCache ??= Promise.all([import('topojson-client'), import('world-atlas/countries-50m.json')]).then(([topo, mod]) => {
    const t = ((mod as { default?: unknown }).default ?? mod) as any
    const fc = topo.feature(t, t.objects.countries) as unknown as { features: { properties?: { name?: string }; geometry: any }[] }
    return fc.features.map((f) => {
      const g = f.geometry
      const polys: Pt[][][] = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      return { name: f.properties?.name ?? '', d: polys.flatMap((p) => p.map((r) => toPath(r, true))).join('') }
    })
  })
  return worldCache
}

type Box = { x: number; y: number; w: number; h: number }

export function MapView({ result, order }: { result: QueryResult; order: number[] }) {
  const shapes = useMemo(() => findShapes(result, order), [result, order])
  const [hover, setHover] = useState<number | null>(null)
  const [world, setWorld] = useState<Country[]>([])
  const [country, setCountry] = useState('')
  useEffect(() => { loadWorld().then(setWorld).catch(() => setWorld([])) }, [])

  // Starting view: the data's extent with room around it (at least a region, so a single point has context)
  const fit = useMemo<Box>(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const s of shapes) for (const [x, y] of s.coords) { x0 = Math.min(x0, sx(x)); x1 = Math.max(x1, sx(x)); y0 = Math.min(y0, sy(y)); y1 = Math.max(y1, sy(y)) }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: W, h: H }
    let w = Math.max(x1 - x0, 20) * 1.25, h = Math.max(y1 - y0, 10) * 1.25
    if (w / h > 2) h = w / 2; else w = h * 2
    return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }
  }, [shapes])
  const [box, setBox] = useState<Box>(fit)
  useEffect(() => setBox(fit), [fit])

  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null)
  const scaleOf = (b: Box) => { const r = svg.current!.getBoundingClientRect(); return { r, k: Math.max(b.w / r.width, b.h / r.height) } } // preserveAspectRatio meet
  const zoom = (f: number, cx?: number, cy?: number) => setBox((b) => {
    let px = b.x + b.w / 2, py = b.y + b.h / 2
    if (svg.current && cx !== undefined && cy !== undefined) { const { r, k } = scaleOf(b); px += (cx - r.left - r.width / 2) * k; py += (cy - r.top - r.height / 2) * k }
    const w = Math.min(W * 1.5, Math.max(0.05, b.w * f)), h = w * (b.h / b.w)
    return { x: px - ((px - b.x) / b.w) * w, y: py - ((py - b.y) / b.h) * h, w, h }
  })
  // Wheel zoom needs a non-passive listener so the page doesn't scroll
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const h = (e: WheelEvent) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.25 : 0.8, e.clientX, e.clientY) }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  })
  const onDown = (e: RPointerEvent) => { drag.current = { x: e.clientX, y: e.clientY, box }; svg.current?.setPointerCapture(e.pointerId) }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || !svg.current) return
    const { k } = scaleOf(d.box)
    setBox({ ...d.box, x: d.box.x - (e.clientX - d.x) * k, y: d.box.y - (e.clientY - d.y) * k })
  }

  if (!shapes.length) return <div className="empty pad">No map data found. Map view reads GeoJSON or WKT columns (for example ST_AsText(geom) or ST_AsGeoJSON(geom)), or a pair of lat / lng columns.</div>

  const unit = box.w / W // keeps points the same size on screen at every zoom
  const row = hover !== null ? result.rows[hover] : null

  return (
    <div className="map-view">
      <div className="map-stage">
        <svg ref={svg} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null }} onMouseLeave={() => { setHover(null); setCountry('') }}>
          <rect x={-W} y={-H} width={W * 3} height={H * 3} className="map-sea" />
          <g className="map-land">
            {world.map((c, k) => <path key={k} d={c.d} onMouseEnter={() => setCountry(c.name)} />)}
          </g>
          {shapes.map((s, k) => s.kind === 'point'
            ? <circle key={k} cx={sx(s.coords[0][0])} cy={sy(s.coords[0][1])} r={(hover === s.row ? 8 : 5.5) * unit} strokeWidth={1.5 * unit} className="map-pt" onMouseEnter={() => setHover(s.row)} />
            : <path key={k} d={toPath(s.coords, s.kind === 'poly')} className={`${s.kind === 'line' ? 'map-line' : 'map-poly'} ${hover === s.row ? 'on' : ''}`} onMouseEnter={() => setHover(s.row)} />)}
        </svg>
        <div className="map-zoom">
          <button className="icon-btn" title="Zoom in" onClick={() => zoom(0.66)}>+</button>
          <button className="icon-btn" title="Zoom out" onClick={() => zoom(1.5)}>−</button>
          <button className="icon-btn" title="Fit to the data" onClick={() => setBox(fit)}>⤢</button>
          <button className="icon-btn" title="Whole world" onClick={() => setBox({ x: 0, y: 0, w: W, h: H })}>◯</button>
        </div>
      </div>
      <div className="map-info small-text muted">
        {shapes.length.toLocaleString()} shapes · scroll to zoom, drag to move{country ? ` · ${country}` : ''}{!world.length ? ' · loading map…' : ''}
        {row && <div className="map-row">{result.columns.slice(0, 6).map((c) => <span key={c}><b>{c}</b>{cellText(row[c]).slice(0, 40)}</span>)}</div>}
      </div>
    </div>
  )
}
