import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, QueryResult } from '../../shared/types'
import { IconArrowDown, IconArrowUp, IconKey } from './Icons'
import { cellText } from '../util'

export type Sort = { col: string; dir: 'asc' | 'desc' } | null

interface Props {
  result: QueryResult
  /** Row indexes to show, in display order (after filter + sort) */
  order: number[]
  columnInfo?: Record<string, ColumnInfo>
  pending?: Record<number, Record<string, unknown>>
  sort: Sort
  onSort: (col: string) => void
  selectedRow: number | null
  onSelectRow: (row: number) => void
  /** When set, cells can be double-clicked to edit. Ctrl+Delete sets NULL. */
  onEdit?: (row: number, col: string, value: string | null) => void
  rowClass?: (row: number) => string
  /** Scroll to and select this row when it changes ({ row, n } — n makes repeats count) */
  focusRow?: { row: number; n: number }
  /** Several selected rows (Ctrl+A, Shift/Ctrl+click); null = only selectedRow */
  selectedRows?: Set<number> | null
  onSelectRows?: (rows: Set<number> | null) => void
}

type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }

const ROW_H = 29
const HEAD_H = 33
const OVERSCAN = 8
// Browsers can't make a scroll area taller than ~33M px, so past this we scale scrolling.
const MAX_SCROLL_H = 8_000_000
const EMPTY: Record<string, unknown> = {}

/** Column widths from the header and a sample of rows, so they don't jump while scrolling. */
function columnWidths(result: QueryResult, info: Record<string, { dataType?: string; primaryKey?: boolean }> = {}) {
  const sample = result.rows.slice(0, 200)
  return result.columns.map((c) => {
    // Header: name + the type label (smaller text) + the key icon
    const t = info[c]?.dataType ?? ''
    let chars = c.length + 4 + (t ? Math.ceil(t.length * 0.8) + 1 : 0) + (info[c]?.primaryKey ? 2 : 0)
    for (const r of sample) {
      const v = r[c]
      const len = v === null || v === undefined ? 4 : cellText(v).length
      if (len > chars) chars = len
    }
    return Math.max(70, Math.min(380, Math.round(chars * 7.4 + 22)))
  })
}

interface RowProps {
  i: number
  displayIndex: number
  columns: string[]
  row: Record<string, unknown>
  edits: Record<string, unknown>
  selCol: string | null
  editingCol: string | null
  selected: boolean
  extraClass: string
  actions: React.MutableRefObject<{
    select: (row: number, col?: string, e?: Mods) => void
    edit: (row: number, col: string) => void
    commit: (row: number, col: string, value: string | null) => void
    cancelEdit: () => void
  }>
}

/** One grid row; memoised so scrolling only renders rows that just came into view. */
const Row = memo(function Row({ i, displayIndex, columns, row, edits, selCol, editingCol, selected, extraClass, actions }: RowProps) {
  return (
    <tr className={`data-row ${displayIndex % 2 ? 'even' : ''} ${selected ? 'row-selected' : ''} ${extraClass}`}>
      <td className="rownum" onClick={(e) => actions.current.select(i, undefined, e)}>{displayIndex + 1}</td>
      {columns.map((col, ci) => {
        const changed = col in edits
        const value = changed ? edits[col] : row[col]
        const isNull = value === null || value === undefined
        const text = isNull ? 'NULL' : cellText(value)
        return (
          <td
            key={`${ci}:${col}`}
            className={[changed && 'changed', isNull && 'null', selected && selCol === col && 'selected', typeof value === 'number' && 'num'].filter(Boolean).join(' ')}
            onClick={(e) => actions.current.select(i, col, e)}
            onDoubleClick={() => actions.current.edit(i, col)}
            // Tooltip only on hover, instead of building one for every cell on every render
            onMouseEnter={(e) => { if (text.length > 30) e.currentTarget.title = text.slice(0, 2000) }}
          >
            {editingCol === col ? (
              <input
                autoFocus
                defaultValue={isNull ? '' : text}
                onBlur={(e) => actions.current.commit(i, col, e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') actions.current.cancelEdit()
                  if (e.key === 'Delete' && e.ctrlKey) actions.current.commit(i, col, null)
                }}
              />
            ) : (text.length > 500 ? text.slice(0, 500) + '…' : text)}
          </td>
        )
      })}
    </tr>
  )
})

export function ResultGrid({ result, order, columnInfo = {}, pending = {}, sort, onSort, selectedRow, onSelectRow, onEdit, rowClass, focusRow, selectedRows = null, onSelectRows }: Props) {
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null)
  const [selCol, setSelCol] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const widths = useMemo(() => columnWidths(result, columnInfo), [result.columns, columnInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  // New query → back to the top (same columns array means the rows were only edited)
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollTop = 0; setScrollTop(0) }, [result.columns])

  // Update at most once per frame while scrolling
  const frame = useRef(0)
  const onScroll = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      if (wrapRef.current) setScrollTop(wrapRef.current.scrollTop)
    })
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // Which rows are on screen. With huge results, scroll position is scaled.
  const bodyH = Math.max(ROW_H, viewH - HEAD_H)
  const totalH = order.length * ROW_H
  const scrollH = Math.min(totalH, MAX_SCROLL_H)
  const ratio = totalH > scrollH ? (totalH - bodyH) / Math.max(1, scrollH - bodyH) : 1
  const virtualTop = scrollTop * ratio
  const firstVis = Math.min(order.length, Math.floor(virtualTop / ROW_H))
  const start = Math.max(0, firstVis - OVERSCAN)
  const end = Math.min(order.length, firstVis + Math.ceil(bodyH / ROW_H) + OVERSCAN)
  const topSpacer = Math.max(0, scrollTop - (virtualTop - firstVis * ROW_H) - (firstVis - start) * ROW_H)
  const bottomSpacer = Math.max(0, scrollH - topSpacer - (end - start) * ROW_H)

  /** Scroll so the row at this display position is visible (keyboard navigation). */
  const reveal = (pos: number) => {
    const el = wrapRef.current
    if (!el) return
    if (pos * ROW_H < virtualTop) el.scrollTop = (pos * ROW_H) / ratio
    else if ((pos + 1) * ROW_H > virtualTop + bodyH) el.scrollTop = ((pos + 1) * ROW_H - bodyH) / ratio
    setScrollTop(el.scrollTop) // draw the rows now, without waiting for the scroll event
  }

  useEffect(() => {
    if (!focusRow) return
    const pos = order.indexOf(focusRow.row)
    if (pos < 0) return
    onSelectRow(focusRow.row)
    setSelCol(result.columns.find((c) => !columnInfo[c]?.autoIncrement) ?? result.columns[0] ?? null)
    reveal(pos)
    wrapRef.current?.focus()
  }, [focusRow?.n])

  const valueAt = (row: number, col: string) => {
    const p = pending[row]
    return p && col in p ? p[col] : result.rows[row][col]
  }

  // Stable handlers for the memoised rows
  const actions = useRef<RowProps['actions']['current']>(null!)
  actions.current = {
    select: (row, col, e) => {
      if (col) setSelCol(col)
      if (e?.shiftKey && selectedRow !== null && onSelectRows) {
        // Range from the current row to this one (current row stays the anchor)
        const a = order.indexOf(selectedRow), b = order.indexOf(row)
        onSelectRows(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)))
        return
      }
      if (e && (e.ctrlKey || e.metaKey) && onSelectRows) {
        const s = new Set(selectedRows ?? (selectedRow !== null ? [selectedRow] : []))
        s.has(row) ? s.delete(row) : s.add(row)
        onSelectRows(s)
        onSelectRow(row)
        return
      }
      onSelectRows?.(null)
      onSelectRow(row)
    },
    edit: (row, col) => { if (onEdit) setEditing({ row, col }) },
    commit: (row, col, value) => { onEdit?.(row, col, value); setEditing(null) },
    cancelEdit: () => setEditing(null)
  }

  const selectAll = () => {
    if (!order.length || !onSelectRows) return
    onSelectRows(new Set(order))
    if (selectedRow === null) onSelectRow(order[0])
  }

  /** Selected rows as tab-separated text with a header line (pastes into Excel) */
  const copyRows = (rows: Set<number>) => {
    const cell = (v: unknown) => (v === null || v === undefined ? '' : cellText(v).replace(/[\t\r\n]+/g, ' '))
    const lines = [result.columns.join('\t')]
    for (const i of order) if (rows.has(i)) lines.push(result.columns.map((c) => cell(valueAt(i, c))).join('\t'))
    navigator.clipboard?.writeText(lines.join('\r\n'))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (editing) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedRows && selectedRows.size > 1) { e.preventDefault(); copyRows(selectedRows); return }
    if (selectedRow === null) return
    const pos = order.indexOf(selectedRow)
    if (e.key.startsWith('Arrow') && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') onSelectRows?.(null)
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selCol) {
      const v = valueAt(selectedRow, selCol)
      navigator.clipboard?.writeText(v === null || v === undefined ? '' : cellText(v))
    } else if (e.key === 'ArrowDown' && pos < order.length - 1) {
      e.preventDefault(); onSelectRow(order[pos + 1]); reveal(pos + 1)
    } else if (e.key === 'ArrowUp' && pos > 0) {
      e.preventDefault(); onSelectRow(order[pos - 1]); reveal(pos - 1)
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && selCol) {
      const ci = result.columns.indexOf(selCol) + (e.key === 'ArrowRight' ? 1 : -1)
      if (ci >= 0 && ci < result.columns.length) { e.preventDefault(); setSelCol(result.columns[ci]) }
    } else if (e.key === 'Enter' && onEdit && selCol) {
      e.preventDefault(); setEditing({ row: selectedRow, col: selCol })
    }
  }

  const rownumW = Math.max(44, String(order.length).length * 8 + 20)

  return (
    <div className="grid-wrap" tabIndex={0} onKeyDown={onKey} ref={wrapRef} onScroll={onScroll}>
      <table className="grid fixed" style={{ width: rownumW + widths.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          <col style={{ width: rownumW }} />
          {widths.map((w, k) => <col key={k} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="rownum corner" onClick={selectAll} title="Select all rows (Ctrl+A)" />
            {result.columns.map((c, ci) => {
              const info = columnInfo[c]
              const active = sort?.col === c
              return (
                <th key={`${ci}:${c}`} onClick={() => onSort(c)} className={active ? 'sorted' : ''} title="Click to sort">
                  <div className="th-inner">
                    {info?.primaryKey && <IconKey className="pk" width={12} height={12} />}
                    <span>{c}</span>
                    {info && <span className="th-type">{info.dataType}</span>}
                    {active && (sort!.dir === 'asc' ? <IconArrowUp className="sort-ico" /> : <IconArrowDown className="sort-ico" />)}
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {topSpacer > 0 && <tr className="spacer-row" style={{ height: topSpacer }} />}
          {order.slice(start, end).map((i, k) => (
            <Row
              key={i}
              i={i}
              displayIndex={start + k}
              columns={result.columns}
              row={result.rows[i]}
              edits={pending[i] ?? EMPTY}
              selected={selectedRows ? selectedRows.has(i) : selectedRow === i}
              extraClass={rowClass?.(i) ?? ''}
              selCol={selectedRow === i ? selCol : null}
              editingCol={editing?.row === i ? editing.col : null}
              actions={actions}
            />
          ))}
          {bottomSpacer > 0 && <tr className="spacer-row" style={{ height: bottomSpacer }} />}
        </tbody>
      </table>
      {order.length === 0 && <div className="placeholder">{result.rows.length ? 'No rows match the filter' : 'No rows'}</div>}
    </div>
  )
}
