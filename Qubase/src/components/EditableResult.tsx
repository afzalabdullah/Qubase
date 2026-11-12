import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo, QueryResult, RowChange, TableInfo } from '../../shared/types'
import { ResultView } from './ResultView'
import { errMsg } from '../util'
import { allowRun } from '../safety'
import { useConn } from '../settings'

/** Remove comments and string literals so keyword checks don't trip on them */
const strip = (sql: string) => sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''")

/** The one table a simple SELECT reads from, or why the result can't be edited */
export function sourceTable(sql: string, tables: TableInfo[]): { table?: TableInfo; why?: string } {
  const s = strip(sql).trim().replace(/;\s*$/, '')
  if (!/^select\b/i.test(s)) return { why: 'Only SELECT results can be edited.' }
  if (/;/.test(s)) return { why: 'Run a single SELECT to edit its rows.' }
  if (/\b(join|union|intersect|except|group\s+by|having|distinct)\b/i.test(s) || /\bfrom\b[^]*,/i.test(s.replace(/\bwhere\b[\s\S]*$/i, '')))
    return { why: 'Results can be edited when the query reads one table (no JOIN, GROUP BY, DISTINCT or UNION).' }
  const m = /\bfrom\s+([\w.[\]"`$#@]+)/i.exec(s)
  if (!m) return { why: 'No table found in the query.' }
  const parts = m[1].replace(/[[\]"`]/g, '').split('.')
  const name = parts.pop()!.toLowerCase(), schema = parts.pop()?.toLowerCase()
  const t = tables.find((x) => x.name.toLowerCase() === name && (!schema || (x.schema ?? '').toLowerCase() === schema))
  if (!t) return { why: `“${m[1]}” is not a table in this database.` }
  if (t.type === 'view') return { why: `${t.name} is a view; open the table to edit rows.` }
  return { table: t }
}

interface Props {
  result: QueryResult
  sql: string
  tables: TableInfo[]
  name: string
  onStatus: (s: string) => void
}

/** Query result that can be edited in place when it comes from one table and includes its primary key. */
export function EditableResult({ result, sql, tables, name, onStatus }: Props) {
  const { conn, connId } = useConn()
  const src = useMemo(() => sourceTable(sql, tables), [sql, tables])
  const [cols, setCols] = useState<ColumnInfo[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<Record<number, Record<string, unknown>>>({})
  const [rows, setRows] = useState(result.rows)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setRows(result.rows); setPending({}); setEditing(false); setError('') }, [result])
  useEffect(() => {
    setCols(null)
    if (src.table) window.db.getStructure(connId, src.table).then((s) => setCols(s.columns)).catch(() => setCols([]))
  }, [connId, src.table])

  const pk = (cols ?? []).filter((c) => c.primaryKey).map((c) => c.name)
  const lower = new Set(result.columns.map((c) => c.toLowerCase()))
  const why = src.why ?? (cols === null ? 'Reading the table…'
    : !pk.length ? `${src.table!.name} has no primary key, so rows can't be told apart.`
    : !pk.every((k) => lower.has(k.toLowerCase())) ? `Include the primary key (${pk.join(', ')}) in the SELECT to edit rows.`
    : conn.readOnly ? 'This connection is read-only.' : '')
  const canEdit = !why
  // Result column → table column (case-insensitive), so edits use the table's spelling
  const colFor = useMemo(() => Object.fromEntries((cols ?? []).map((c) => [c.name.toLowerCase(), c])), [cols])
  const count = Object.values(pending).reduce((n, c) => n + Object.keys(c).length, 0)

  const onEdit = (row: number, col: string, v: unknown) => {
    const c = colFor[col.toLowerCase()]
    if (!c) { onStatus(`${col} is not a column of ${src.table?.name} (computed values can't be edited)`); return }
    setPending((p) => {
      const orig = rows[row]?.[col]
      const n = { ...(p[row] ?? {}) }
      if (v === orig || (v === '' && orig === null)) delete n[col]; else n[col] = v
      const out = { ...p }
      if (Object.keys(n).length) out[row] = n; else delete out[row]
      return out
    })
  }

  const save = async () => {
    const t = src.table!
    if (!allowRun(conn, { what: `update ${Object.keys(pending).length} row(s) in ${t.name}` })) return
    setBusy(true); setError('')
    const keyCol = (k: string) => result.columns.find((c) => c.toLowerCase() === k.toLowerCase())!
    const changes: RowChange[] = Object.entries(pending).map(([i, ch]) => ({
      op: 'update', table: t,
      primaryKey: Object.fromEntries(pk.map((k) => [k, rows[Number(i)][keyCol(k)]])),
      changes: Object.fromEntries(Object.entries(ch).map(([c, v]) => [colFor[c.toLowerCase()].name, v]))
    }))
    try {
      const n = await window.db.applyChanges(connId, changes)
      setRows((rs) => rs.map((r, i) => (pending[i] ? { ...r, ...pending[i] } : r)))
      setPending({})
      onStatus(`Saved · ${n} row${n === 1 ? '' : 's'} updated in ${t.name}`)
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  const shown = useMemo(() => ({ ...result, rows }), [result, rows])
  const columnInfo = useMemo(() => Object.fromEntries(result.columns.flatMap((c) => (colFor[c.toLowerCase()] ? [[c, colFor[c.toLowerCase()]]] : []))), [result.columns, colFor])

  return (
    <div className="editable-result">
      <div className={`edit-bar ${editing ? 'on' : ''}`}>
        {editing
          ? <><strong>Editing {src.table?.name}</strong><span className="muted small-text">Double-click a cell to change it · Ctrl+Delete sets NULL</span></>
          : <span className="muted small-text">{canEdit ? `Rows come from ${src.table!.name} and can be edited.` : why}</span>}
        <span className="spacer" />
        {count > 0 && <span className="pill warn">{count} pending change{count === 1 ? '' : 's'}</span>}
        {editing && count > 0 && <button className="btn btn-sm" onClick={() => setPending({})} disabled={busy}>Discard</button>}
        {editing && count > 0 && <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>}
        <button className={`btn btn-sm ${editing ? 'btn-on' : ''}`} disabled={!canEdit} title={why || 'Edit cells in this result and save them to the table'}
          onClick={() => { if (editing && count && !window.confirm('Stop editing and discard your changes?')) return; if (editing) setPending({}); setEditing((e) => !e) }}>
          {editing ? 'Done' : 'Edit rows'}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      <ResultView result={shown} name={name} tableName={src.table?.name} onStatus={onStatus}
        columnInfo={editing ? columnInfo : undefined} pending={editing ? pending : undefined} onEdit={editing ? onEdit : undefined} />
    </div>
  )
}
