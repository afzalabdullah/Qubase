import { useContext, useEffect, useMemo, useState } from 'react'
import { ConnContext } from '../settings'
import type { ColumnInfo, ExportFormat, QueryResult } from '../../shared/types'
import { ResultGrid, Sort } from './ResultGrid'
import { JsonPanel } from './JsonPanel'
import { ChartView } from './ChartView'
import { PivotView } from './PivotView'
import { ResultDiff, getPinned, setPinned } from './ResultDiff'
import { IconBraces, IconChart, IconCompare, IconCopy, IconDownload, IconSearch } from './Icons'
import { COPY_FORMATS, CopyFormat, fmtNum, formatRows, stats } from '../copyFormats'
import { cellText, errMsg } from '../util'

interface Props {
  result: QueryResult
  /** Used as the default export file name */
  name: string
  columnInfo?: Record<string, ColumnInfo>
  pending?: Record<number, Record<string, unknown>>
  onEdit?: (row: number, col: string, value: string | null) => void
  onStatus?: (s: string) => void
  /** Extra CSS class per row (e.g. new or deleted rows) */
  rowClass?: (row: number) => string
  /** Told when the selection changes: the current row and every selected row */
  onSelectionChange?: (row: number | null, rows: number[]) => void
  /** Selection and sort reset when this changes (defaults to the result itself) */
  resetKey?: unknown
  focusRow?: { row: number; n: number }
  /** Table name used in exported INSERT statements */
  tableName?: string
  /** When set, sorting is done by the database: the grid shows this sort and calls onServerSort */
  serverSort?: Sort
  onServerSort?: (col: string) => void
}

function readPref(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1' } catch { return fallback }
}

/** Compare cells for sorting: numbers numerically, NULLs last, text naturally. */
function compare(a: unknown, b: unknown) {
  const an = a === null || a === undefined, bn = b === null || b === undefined
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Result grid + toolbar (filter, export, JSON panel toggle) + optional JSON side panel. */
export function ResultView({ result, name, columnInfo, pending = {}, onEdit, onStatus, rowClass, onSelectionChange, resetKey, focusRow, tableName, serverSort, onServerSort }: Props) {
  const [mode, setMode] = useState<'grid' | 'chart' | 'pivot'>('grid')
  const chart = mode === 'chart'
  const [copyOpen, setCopyOpen] = useState(false)
  const [showTotals, setShowTotals] = useState(() => readPref('totals', true))
  const [diffOpen, setDiffOpen] = useState(false)
  const [hasPinned, setHasPinned] = useState(() => !!getPinned())
  useEffect(() => {
    const f = () => setHasPinned(!!getPinned())
    window.addEventListener('qubase:pinned', f)
    return () => window.removeEventListener('qubase:pinned', f)
  }, [])
  useEffect(() => { try { localStorage.setItem('totals', showTotals ? '1' : '0') } catch { /* ignore */ } }, [showTotals])
  const engine = useContext(ConnContext)?.engine
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>(null)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<number> | null>(null)
  const [showJson, setShowJson] = useState(() => readPref('jsonPanel', false))
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => { setSelectedRow(null); setSelectedRows(null); setSort(null) }, [resetKey ?? result])
  useEffect(() => {
    onSelectionChange?.(selectedRow, selectedRows ? [...selectedRows] : selectedRow === null ? [] : [selectedRow])
  }, [selectedRow, selectedRows])
  // Filtering or sorting changes which rows are visible, so a multi-selection no longer applies
  useEffect(() => { setSelectedRows(null) }, [filter, sort])
  useEffect(() => { try { localStorage.setItem('jsonPanel', showJson ? '1' : '0') } catch { /* ignore */ } }, [showJson])

  const order = useMemo(() => {
    let idx = result.rows.map((_, i) => i)
    const f = filter.trim().toLowerCase()
    if (f) idx = idx.filter((i) => result.columns.some((c) => cellText(result.rows[i][c]).toLowerCase().includes(f)))
    if (sort && !onServerSort) {
      const m = sort.dir === 'asc' ? 1 : -1
      idx = [...idx].sort((x, y) => m * compare(result.rows[x][sort.col], result.rows[y][sort.col]))
    }
    return idx
  }, [result, filter, sort])

  const cycleSort = (col: string) =>
    setSort((s) => (!s || s.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null))

  const doExport = async (format: ExportFormat) => {
    setExportOpen(false)
    try {
      const rows = order.map((i) => result.rows[i])
      const path = await window.db.exportData({ columns: result.columns, rows }, format, name, tableName ?? name.replace(/\W+/g, '_'), engine)
      if (path) onStatus?.(`Exported ${rows.length} rows to ${path}`)
    } catch (e) {
      onStatus?.(`Export failed: ${errMsg(e)}`)
    }
  }

  /** Rows the copy and totals use: the selected rows if several, else every visible row */
  const pickedRows = useMemo(() => (selectedRows && selectedRows.size > 1 ? order.filter((i) => selectedRows.has(i)) : order), [order, selectedRows])
  const totals = useMemo(() => {
    if (!showTotals || !result.columns.length) return []
    return result.columns.map((c) => ({ c, s: stats(pickedRows.map((i) => result.rows[i][c])) })).filter((x) => x.s && !/(^|_)id$/i.test(x.c)).slice(0, 8)
  }, [showTotals, pickedRows, result])

  const copyAs = async (f: CopyFormat) => {
    setCopyOpen(false)
    const rows = pickedRows.map((i) => result.rows[i])
    try {
      await navigator.clipboard.writeText(formatRows(f, result.columns, rows, engine, tableName ?? name.replace(/\W+/g, '_')))
      onStatus?.(`Copied ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'} as ${COPY_FORMATS.find((x) => x[0] === f)![1]}`)
    } catch (e) { onStatus?.(`Copy failed: ${errMsg(e)}`) }
  }

  if (!result.columns.length) {
    return <div className="placeholder ok">✓ Statement executed · {result.rowCount} row{result.rowCount === 1 ? '' : 's'} affected</div>
  }

  const rowObject = (i: number) => Object.fromEntries(result.columns.map((c) => [c, pending[i] && c in pending[i] ? pending[i][c] : result.rows[i][c]]))
  // Several rows selected → JSON array of all of them (in display order); otherwise the current row
  const jsonValue = useMemo(() => {
    if (!showJson) return null
    if (selectedRows && selectedRows.size > 1) return order.filter((i) => selectedRows.has(i)).map(rowObject)
    return selectedRow !== null ? rowObject(selectedRow) : null
  }, [showJson, selectedRows, selectedRow, order, pending, result])

  return (
    <div className="result-view">
      <div className="result-bar">
        <div className="result-filter">
          <IconSearch className="search-icon" />
          <input placeholder="Filter results" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <span className="muted small-text">
          {order.length === result.rows.length ? `${result.rows.length.toLocaleString()} rows` : `${order.length.toLocaleString()} of ${result.rows.length.toLocaleString()} rows`}
        </span>
        {selectedRows && selectedRows.size > 1 && (
          <span className="pill" title="Ctrl+C copies them (with headers, pastes into Excel). Click a row to clear.">
            {selectedRows.size.toLocaleString()} selected
          </span>
        )}
        {result.truncated && (
          <span className="truncated-note" title="The query returned more rows. Raise the row limit next to Run, or add WHERE / TOP to your query.">
            ⚠ Limited to the first {result.rows.length.toLocaleString()} rows
          </span>
        )}
        <div className="spacer" />
        <div className="menu-wrap">
          <button className="btn btn-sm" onClick={() => setExportOpen((o) => !o)}><IconDownload width={14} height={14} /> Export</button>
          {exportOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setExportOpen(false)} />
              <div className="menu">
                <button onClick={() => doExport('excel')}><span className="fmt xl">XLSX</span> Excel workbook</button>
                <button onClick={() => doExport('csv')}><span className="fmt csv">CSV</span> Comma-separated</button>
                <button onClick={() => doExport('json')}><span className="fmt js">JSON</span> JSON array</button>
                <button onClick={() => doExport('sql')}><span className="fmt sql">SQL</span> INSERT statements</button>
                <button onClick={() => doExport('markdown')}><span className="fmt md">MD</span> Markdown table</button>
                <button onClick={() => doExport('html')}><span className="fmt html">HTML</span> HTML table</button>
              </div>
            </>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn btn-sm" onClick={() => setCopyOpen((o) => !o)} title={selectedRows && selectedRows.size > 1 ? 'Copy the selected rows' : 'Copy the visible rows'}><IconCopy width={13} height={13} /> Copy as</button>
          {copyOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setCopyOpen(false)} />
              <div className="menu">{COPY_FORMATS.map(([f, label]) => <button key={f} onClick={() => copyAs(f)}>{label}</button>)}</div>
            </>
          )}
        </div>
        <button className={`btn btn-sm ${mode === 'pivot' ? 'btn-on' : ''}`} onClick={() => setMode((m) => (m === 'pivot' ? 'grid' : 'pivot'))} title="Pivot table: group rows and columns">Pivot</button>
        <button className={`btn btn-sm ${chart ? 'btn-on' : ''}`} onClick={() => setMode((m) => (m === 'chart' ? 'grid' : 'chart'))} title="Chart these rows"><IconChart width={14} height={14} /> Chart</button>
        <button className={`btn btn-sm ${showTotals ? 'btn-on' : ''}`} onClick={() => setShowTotals((t) => !t)} title="Sum, average, min and max of number columns (selected rows, or all visible rows)">Σ</button>
        <button className="btn btn-sm" title={hasPinned ? `Compare with the pinned result (${getPinned()?.name})` : 'Pin this result, run another query, then compare'}
          onClick={() => { if (hasPinned && getPinned()?.result !== result) setDiffOpen(true); else { setPinned(hasPinned ? null : { name, result }); onStatus?.(hasPinned ? 'Pinned result cleared' : 'Pinned. Run another query, then press Compare.') } }}>
          <IconCompare width={13} height={13} /> {hasPinned ? (getPinned()?.result === result ? 'Unpin' : 'Compare') : 'Pin'}
        </button>
        <button className={`btn btn-sm ${showJson ? 'btn-on' : ''}`} onClick={() => setShowJson((s) => !s)} title="Show the selected row as JSON">
          <IconBraces width={14} height={14} /> JSON
        </button>
      </div>
      {chart && <ChartView result={result} order={order} />}
      {mode === 'pivot' && <PivotView result={result} order={order} />}
      <div className="result-body" style={mode !== 'grid' ? { display: 'none' } : undefined}>
        <ResultGrid
          result={result}
          order={order}
          columnInfo={columnInfo}
          pending={pending}
          sort={onServerSort ? serverSort ?? null : sort}
          onSort={onServerSort ?? cycleSort}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          selectedRows={selectedRows}
          onSelectRows={setSelectedRows}
          onEdit={onEdit}
          rowClass={rowClass}
          focusRow={focusRow}
        />
        {showJson && <JsonPanel value={jsonValue} onClose={() => setShowJson(false)} />}
      </div>
      {mode === 'grid' && totals.length > 0 && (
        <div className="totals-bar" title={selectedRows && selectedRows.size > 1 ? 'Selected rows' : 'All visible rows'}>
          <span className="muted">{selectedRows && selectedRows.size > 1 ? `${selectedRows.size} selected` : 'All rows'}:</span>
          {totals.map(({ c, s }) => (
            <span key={c} className="total-item"><strong>{c}</strong> Σ {fmtNum(s!.sum)} · avg {fmtNum(s!.avg)} · min {fmtNum(s!.min)} · max {fmtNum(s!.max)}</span>
          ))}
        </div>
      )}
      {diffOpen && getPinned() && <ResultDiff after={result} afterName={name} onClose={() => setDiffOpen(false)} />}
    </div>
  )
}
