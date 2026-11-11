import { useEffect, useMemo, useRef, useState } from 'react'
import type { SavedConnection, TableInfo } from '../../shared/types'

/**
 * Searchable dropdown: type to filter, arrow keys + Enter to pick, or click.
 * Typed text that matches nothing is kept when `free` is set (e.g. a table that isn't listed).
 * onChange runs only when a value is picked or the box loses focus, not on every key.
 */
export function Combo({ value, options, onChange, placeholder, loading, free = true, width = 220, title, emptyText = 'No matches' }: {
  value: string
  options: string[]
  onChange: (v: string) => void
  placeholder?: string
  loading?: boolean
  free?: boolean
  width?: number
  title?: string
  emptyText?: string
}) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [typed, setTyped] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { setText(value) }, [value])

  // Show everything until the user types; then rank "starts with" above "contains"
  const shown = useMemo(() => {
    const q = typed ? text.trim().toLowerCase() : ''
    if (!q) return options.slice(0, 500)
    const starts: string[] = [], contains: string[] = []
    for (const o of options) {
      const l = o.toLowerCase()
      const short = l.split('.').pop()!
      if (l.startsWith(q) || short.startsWith(q)) starts.push(o)
      else if (l.includes(q)) contains.push(o)
    }
    return [...starts, ...contains].slice(0, 500)
  }, [options, text, typed])

  useEffect(() => { setHi(0) }, [text])
  useEffect(() => { (list.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }) }, [hi])

  const pick = (v: string) => { setText(v); setOpen(false); setTyped(false); if (v !== value) onChange(v) }
  const commitTyped = () => {
    setOpen(false); setTyped(false)
    const exact = options.find((o) => o.toLowerCase() === text.trim().toLowerCase())
    if (exact) pick(exact)
    else if (free) { if (text.trim() !== value) onChange(text.trim()) }
    else setText(value)
  }

  return (
    <div className="combo" style={{ width }} title={title}>
      <input value={text} placeholder={placeholder} role="combobox" aria-expanded={open}
        onChange={(e) => { setText(e.target.value); setTyped(true); setOpen(true) }}
        onFocus={(e) => { e.target.select(); setOpen(true) }}
        onBlur={() => setTimeout(commitTyped, 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, shown.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (open && shown[hi]) pick(shown[hi]); else commitTyped(); (e.target as HTMLInputElement).blur() }
          else if (e.key === 'Escape') { setText(value); setOpen(false); setTyped(false) }
        }} />
      <span className="combo-caret" aria-hidden>▾</span>
      {open && (
        <div className="combo-list" ref={list} role="listbox">
          {loading && <div className="combo-empty">Loading…</div>}
          {!loading && shown.length === 0 && <div className="combo-empty">{options.length ? emptyText : 'Nothing to list'}</div>}
          {shown.map((o, i) => (
            <div key={o} role="option" aria-selected={i === hi} className={`combo-item ${i === hi ? 'hi' : ''} ${o === value ? 'cur' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o) }} onMouseEnter={() => setHi(i)}>{o}</div>
          ))}
          {!typed && options.length > 500 && <div className="combo-empty">Type to search all {options.length.toLocaleString()}</div>}
        </div>
      )}
    </div>
  )
}

/** Table label used in pickers: schema.name, or just name */
export const tableLabel = (t: TableInfo) => (t.schema ? `${t.schema}.${t.name}` : t.name)

/**
 * Databases and tables of a compare target. Opens a short connection to list them
 * (or reuses this one when the target is this connection on its own database).
 */
export function useTargetCatalog(connId: string, target: SavedConnection | undefined, sameConn: boolean, database: string) {
  const [databases, setDatabases] = useState<string[]>([])
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setDatabases([]); setTables([])
    if (!target) return
    let cancelled = false
    let opened = ''
    setLoading(true)
    ;(async () => {
      try {
        const id = sameConn && !database ? connId : (opened = (await window.db.connect({ ...target.config, database: database || target.config.database })).id)
        const [d, t] = await Promise.all([window.db.listDatabases(id).catch(() => null), window.db.listTables(id).catch(() => [] as TableInfo[])])
        if (!cancelled) { setDatabases(d?.databases ?? []); setTables(t) }
      } catch { /* the compare itself shows connection errors */ } finally {
        if (!cancelled) setLoading(false)
        if (opened) window.db.disconnect(opened).catch(() => {})
      }
    })()
    return () => { cancelled = true }
  }, [connId, target?.id, sameConn, database]) // eslint-disable-line react-hooks/exhaustive-deps
  return { databases, tables, loading }
}
