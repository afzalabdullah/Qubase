import { editorTheme } from '../editorThemes'
import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import type { ColumnInfo, ForeignKeyInfo, QueryResult, RowChange, TableInfo } from '../../shared/types'
import { quote, tableRef } from '../../shared/ddl'
import { ResultView } from './ResultView'
import { TableDesigner } from './TableDesigner'
import type { TableView } from './Sidebar'
import { ImportDialog } from './ImportDialog'
import type { Sort } from './ResultGrid'
import { IconChevron, IconCopy, IconLink, IconPlus, IconRefresh, IconSearch, IconTrash } from './Icons'
import { cellText, errMsg } from '../util'
import { allowRun } from '../safety'
import { readSettings, useConn } from '../settings'
import { TestDataDialog } from './TestDataDialog'

interface Props {
  connId: string
  table: TableInfo
  canEdit: boolean
  engine: string
  dark: boolean
  initialView?: TableView
  /** Open the Data tab filtered by this condition (foreign-key navigation) */
  initialWhere?: string
  onStatus: (s: string) => void
  onOpenTable: (t: TableInfo, view?: TableView, where?: string) => void
  onOpenQuery: (title: string, text: string) => void
  /** After structure changes, so the sidebar can reload */
  onSchemaChanged: () => void
}

/** A table: browse and edit rows, design its structure, or see its CREATE script. */
export function TableTab({ connId, table, canEdit, engine, dark, initialView = 'data', initialWhere, onStatus, onOpenQuery, onSchemaChanged, onOpenTable }: Props) {
  const [view, setView] = useState<TableView>(initialView)
  const noScript = engine === 'mongodb' || engine === 'redis'

  return (
    <div className="table-tab">
      <div className="subtabs">
        <button className={view === 'data' ? 'on' : ''} onClick={() => setView('data')}>Data</button>
        <button className={view === 'structure' ? 'on' : ''} onClick={() => setView('structure')}>{table.type === 'view' || noScript ? 'Columns' : 'Structure'}</button>
        {!noScript && <button className={view === 'script' ? 'on' : ''} onClick={() => setView('script')}>Script</button>}
      </div>
      {/* Data stays mounted so staged edits survive switching tabs */}
      <div className="subtab-body" style={{ display: view === 'data' ? 'flex' : 'none' }}>
        <DataView connId={connId} table={table} engine={engine} canEdit={canEdit && table.type !== 'view'} initialWhere={initialWhere} onStatus={onStatus} onOpenQuery={onOpenQuery} onOpenTable={onOpenTable} />
      </div>
      {view === 'structure' && (
        <div className="subtab-body">
          <TableDesigner connId={connId} engine={engine} table={table} onStatus={onStatus} onOpenQuery={onOpenQuery} onChanged={onSchemaChanged} />
        </div>
      )}
      {view === 'script' && <div className="subtab-body"><ScriptView connId={connId} table={table} dark={dark} onOpenQuery={onOpenQuery} /></div>}
    </div>
  )
}

function ScriptView({ connId, table, dark, onOpenQuery }: { connId: string; table: TableInfo; dark: boolean; onOpenQuery: (t: string, s: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    window.db.getDefinition(connId, { ...table, kind: table.type === 'view' ? 'view' : 'table' }).then(setText).catch((e) => setError(errMsg(e)))
  }, [connId, table.schema, table.name])
  return (
    <div className="script-view">
      <div className="toolbar">
        <div className="crumb"><strong>{table.name}</strong> <span className="muted">· {table.type === 'view' ? 'view definition' : 'CREATE script'}</span></div>
        <div className="spacer" />
        <button className="btn btn-sm" disabled={!text} onClick={() => navigator.clipboard?.writeText(text)}><IconCopy width={13} height={13} /> Copy</button>
        <button className="btn btn-sm btn-primary" disabled={!text} onClick={() => onOpenQuery(table.name, text)}>Open in editor</button>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="script-body">
        <CodeMirror value={text} height="100%" theme={editorTheme(readSettings().editorTheme, dark)} extensions={[sql()]} editable={false} basicSetup={{ foldGutter: false }} />
      </div>
    </div>
  )
}

/** SQL literal for a filter value */
function literal(v: unknown) {
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  return `'${cellText(v).replace(/'/g, "''")}'`
}

interface DataProps {
  connId: string
  table: TableInfo
  engine: string
  canEdit: boolean
  initialWhere?: string
  onStatus: (s: string) => void
  onOpenQuery: (title: string, text: string) => void
  onOpenTable: (t: TableInfo, view?: TableView, where?: string) => void
}

/**
 * Rows, one page at a time. Filtering (WHERE) and sorting run on the database,
 * so they cover the whole table, not just the loaded rows.
 * Edits, new rows and deletes are staged until Apply.
 */
function DataView({ connId, table, engine, canEdit, initialWhere, onStatus, onOpenQuery, onOpenTable }: DataProps) {
  const { conn } = useConn()
  const [result, setResult] = useState<QueryResult | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [fks, setFks] = useState<ForeignKeyInfo[]>([])
  const [pending, setPending] = useState<Record<number, Record<string, unknown>>>({})
  const [newRows, setNewRows] = useState<Record<string, unknown>[]>([])
  const [deleted, setDeleted] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<number | null>(null)
  const [selectedAll, setSelectedAll] = useState<number[]>([])
  const [error, setError] = useState('')
  const [pageSize, setPageSize] = useState(() => readSettings().pageSize)
  const [offset, setOffset] = useState(0)
  const [whereInput, setWhereInput] = useState(initialWhere ?? '')
  const [where, setWhere] = useState(initialWhere ?? '')
  const [sort, setSort] = useState<Sort>(null)
  const [loading, setLoading] = useState(false)
  const [loadCount, setLoadCount] = useState(0)
  const [focusRow, setFocusRow] = useState<{ row: number; n: number } | undefined>()
  const [menu, setMenu] = useState<'' | 'more' | 'fk'>('')
  const [importing, setImporting] = useState(false)

  // Structure (columns + foreign keys) once per table
  useEffect(() => {
    window.db.getStructure(connId, table)
      .then((s) => { setColumns(s.columns); setFks(s.foreignKeys) })
      .catch(() => window.db.listColumns(connId, table).then(setColumns).catch(() => {}))
  }, [connId, table.name, table.schema])

  const load = async () => {
    setError(''); setLoading(true)
    try {
      const data = await window.db.selectPage(connId, table, { offset, limit: pageSize, where: where || undefined, orderBy: sort ? [sort] : undefined })
      setResult(data); setTotal(data.total); setPending({}); setNewRows([]); setDeleted(new Set())
      setLoadCount((n) => n + 1)
      onStatus(`${data.rowCount.toLocaleString()} rows${data.total !== null ? ` of ${data.total.toLocaleString()}` : ''} · ${data.durationMs} ms`)
    } catch (e) {
      setError(errMsg(e))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [connId, table.name, table.schema, pageSize, offset, where, sort])

  const changeCount = Object.values(pending).reduce((n, c) => n + Object.keys(c).length, 0) + newRows.length + deleted.size
  /** Leaving the page drops staged changes, so ask first */
  const guard = (fn: () => void) => () => { if (!changeCount || window.confirm('Discard your pending changes on this page?')) fn() }
  const applyFilter = guard(() => { setOffset(0); setWhere(whereInput.trim()) })
  const onSort = (col: string) => guard(() => { setOffset(0); setSort((s) => (!s || s.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null)) })()

  const pkCols = columns.filter((c) => c.primaryKey).map((c) => c.name)
  const editable = canEdit && pkCols.length > 0
  const readOnlyReason = conn.readOnly ? 'Read-only connection' : !canEdit ? 'Read-only' : pkCols.length === 0 ? 'Read-only: no primary key' : ''
  const base = result?.rows.length ?? 0

  // Loaded rows followed by new ones, so the grid shows both
  const shown = useMemo<QueryResult | null>(() => {
    if (!result) return null
    const cols = result.columns.length ? result.columns : columns.map((c) => c.name)
    return { ...result, columns: cols, rows: newRows.length ? [...result.rows, ...newRows] : result.rows }
  }, [result, newRows, columns])

  const onEdit = (row: number, col: string, value: string | null) => {
    if (row >= base) setNewRows((rs) => rs.map((r, i) => (i === row - base ? { ...r, [col]: value } : r)))
    else setPending((p) => ({ ...p, [row]: { ...p[row], [col]: value } }))
  }

  const addRow = () => {
    setFocusRow({ row: base + newRows.length, n: Date.now() })
    setNewRows((rs) => [...rs, {}])
  }
  /** Mark every selected row for deletion (or unmark them if they all are already) */
  const deleteSelected = () => {
    const rows = selectedAll.length ? selectedAll : selected === null ? [] : [selected]
    if (!rows.length) return
    const newOnes = new Set(rows.filter((r) => r >= base).map((r) => r - base))
    if (newOnes.size) setNewRows((rs) => rs.filter((_, i) => !newOnes.has(i)))
    const loaded = rows.filter((r) => r < base)
    setDeleted((d) => {
      const n = new Set(d)
      const allMarked = loaded.every((r) => n.has(r))
      for (const r of loaded) allMarked ? n.delete(r) : n.add(r)
      return n
    })
  }

  const apply = async () => {
    if (!result) return
    const parts = [deleted.size && `delete ${deleted.size}`, newRows.length && `insert ${newRows.length}`, Object.keys(pending).length && `update ${Object.keys(pending).length}`].filter(Boolean)
    if (!allowRun(conn, { what: `${parts.join(', ')} row(s) in ${table.name}` })) return
    const pkOf = (i: number) => Object.fromEntries(pkCols.map((k) => [k, result.rows[i][k]]))
    const changes: RowChange[] = [
      ...[...deleted].map((i) => ({ op: 'delete' as const, table, primaryKey: pkOf(i) })),
      ...Object.entries(pending).filter(([i]) => !deleted.has(Number(i))).map(([i, ch]) => ({ op: 'update' as const, table, primaryKey: pkOf(Number(i)), changes: ch })),
      ...newRows.map((values) => ({ op: 'insert' as const, table, values }))
    ]
    try {
      const n = await window.db.applyChanges(connId, changes)
      onStatus(`Saved · ${n} row${n === 1 ? '' : 's'} affected`)
      await load()
    } catch (e) { setError(errMsg(e)) }
  }

  const discard = () => { setPending({}); setNewRows([]); setDeleted(new Set()) }
  const colTypes = Object.fromEntries(columns.map((c) => [c.name, c]))
  const rowClass = (i: number) => (i >= base ? 'row-new' : deleted.has(i) ? 'row-deleted' : '')
  const selCount = selectedAll.length || (selected === null ? 0 : 1)
  const selectedIsDeleted = selCount > 0 && (selectedAll.length ? selectedAll : [selected!]).every((r) => deleted.has(r))

  // ---- foreign-key navigation ----
  const selRow = result && selected !== null && selected < base ? result.rows[selected] : null
  const followFk = (fk: ForeignKeyInfo) => {
    if (!selRow) return
    const conds = fk.columns.map((c, i) => (selRow[c] === null || selRow[c] === undefined ? null : `${quote(engine, fk.refColumns[i])} = ${literal(selRow[c])}`))
    if (conds.some((c) => c === null)) { onStatus('That row has no value in the foreign key'); return }
    onOpenTable({ schema: fk.refSchema ?? table.schema, name: fk.refTable, type: 'table' }, 'data', conds.join(' AND '))
  }

  const [testData, setTestData] = useState(false)

  const from = total === 0 ? 0 : offset + 1
  const to = offset + base
  const lastPage = total !== null ? offset + pageSize >= total : base < pageSize

  return (
    <div className="table-data">
      {testData && <TestDataDialog engine={engine} table={table} columns={columns} onOpenQuery={onOpenQuery} onClose={() => setTestData(false)} />}
      <div className="toolbar">
        <div className="crumb">{table.schema && <span className="muted">{table.schema} / </span>}<strong>{table.name}</strong></div>
        {canEdit && (
          <>
            <button className="btn btn-sm" onClick={addRow} title="Add a row (fill cells by double-clicking; empty cells use the column default)"><IconPlus width={13} height={13} /> Row</button>
            <button className="btn btn-sm" onClick={deleteSelected} disabled={selCount === 0 || (!editable && (selected ?? 0) < base)} title="Mark the selected rows for deletion">
              <IconTrash width={13} height={13} /> {selectedIsDeleted ? 'Undelete' : 'Delete'}{selCount > 1 ? ` ${selCount.toLocaleString()}` : ''}
            </button>
          </>
        )}
        {fks.length > 0 && (
          <div className="menu-wrap">
            <button className="btn btn-sm" disabled={!selRow} onClick={() => setMenu((m) => (m === 'fk' ? '' : 'fk'))} title="Open the row this row points to (select a row first)">
              <IconLink width={13} height={13} /> Go to
            </button>
            {menu === 'fk' && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu('')} />
                <div className="menu" onClick={() => setMenu('')}>
                  {fks.map((fk) => <button key={fk.name} onClick={() => followFk(fk)}>{fk.columns.join(', ')} → {fk.refTable}</button>)}
                </div>
              </>
            )}
          </div>
        )}
        <div className="menu-wrap">
          <button className="btn btn-sm" onClick={() => setMenu((m) => (m === 'more' ? '' : 'more'))}>More</button>
          {menu === 'more' && (
            <>
              <div className="menu-backdrop" onClick={() => setMenu('')} />
              <div className="menu" onClick={() => setMenu('')}>
                {canEdit && <button onClick={() => setImporting(true)}>Import from CSV / Excel / JSON…</button>}
                {canEdit && <button onClick={() => setTestData(true)}>Generate test data…</button>}
                <button onClick={() => onOpenQuery(`Count ${table.name}`, `SELECT COUNT(*) FROM ${tableRef(engine, table)}${where ? ` WHERE ${where}` : ''};`)}>Count rows in a query tab</button>
              </div>
            </>
          )}
        </div>
        <div className="spacer" />
        {readOnlyReason && <span className="pill">{readOnlyReason}</span>}
        {changeCount > 0 && (
          <>
            <span className="pill warn">{changeCount} pending change{changeCount === 1 ? '' : 's'}</span>
            <button className="btn btn-sm" onClick={discard}>Discard</button>
            <button className="btn btn-primary btn-sm" onClick={apply}>Apply</button>
          </>
        )}
        <button className={`icon-btn ${loading ? 'spin' : ''}`} title="Refresh" onClick={guard(load)}><IconRefresh /></button>
      </div>
      <form className="where-bar" onSubmit={(e) => { e.preventDefault(); applyFilter() }}>
        <span className="where-label">WHERE</span>
        <input value={whereInput} onChange={(e) => setWhereInput(e.target.value)} placeholder="e.g. status = 'active' AND created_at > '2026-01-01'   (runs on the server, Enter to apply)" spellCheck={false} />
        {where && <button type="button" className="btn btn-sm" onClick={guard(() => { setWhereInput(''); setWhere(''); setOffset(0) })}>Clear</button>}
        <button className="btn btn-sm" type="submit"><IconSearch width={13} height={13} /> Filter</button>
        <span className="pager">
          <button type="button" className="icon-btn" disabled={offset === 0} onClick={guard(() => setOffset(Math.max(0, offset - pageSize)))} title="Previous page"><IconChevron style={{ transform: 'rotate(180deg)' }} /></button>
          <span className="small-text">{from.toLocaleString()}–{to.toLocaleString()}{total !== null ? ` of ${total.toLocaleString()}` : ''}</span>
          <button type="button" className="icon-btn" disabled={lastPage} onClick={guard(() => setOffset(offset + pageSize))} title="Next page"><IconChevron /></button>
          <select value={pageSize} onChange={(e) => guard(() => { setOffset(0); setPageSize(Number(e.target.value)) })()} title="Rows per page">
            {[100, 200, 500, 1000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()} / page</option>)}
          </select>
        </span>
      </form>
      {error && <div className="notice error" onClick={() => setError('')}>{error}</div>}
      <div className="results-pane">
        {shown && (
          <ResultView
            result={shown}
            resetKey={loadCount}
            name={table.name}
            tableName={table.name}
            columnInfo={colTypes}
            pending={pending}
            // New rows can always be filled in; loaded rows need a primary key
            onEdit={canEdit ? (row, col, v) => { if (row >= base || editable) onEdit(row, col, v) } : undefined}
            onStatus={onStatus}
            rowClass={rowClass}
            onSelectionChange={(row, rows) => { setSelected(row); setSelectedAll(rows.length > 1 ? rows : []) }}
            focusRow={focusRow}
            serverSort={sort}
            onServerSort={onSort}
          />
        )}
      </div>
      {importing && <ImportDialog table={table} columns={columns} onClose={() => setImporting(false)} onDone={(n) => { onStatus(`Imported ${n.toLocaleString()} rows`); load() }} />}
    </div>
  )
}
