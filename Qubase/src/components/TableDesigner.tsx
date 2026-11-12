import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo, DbObject, TableInfo, TableStructure } from '../../shared/types'
import { alterTableSql, COMMON_TYPES, createIndexSql, createTableSql, DesignColumn, dropIndexSql } from '../../shared/ddl'
import { IconCode, IconKey, IconPlus, IconRefresh, IconTrash } from './Icons'
import { errMsg } from '../util'
import { TypeInput } from './TypeInput'
import { allowRun, checkSql } from '../safety'
import { useConn } from '../settings'

interface Props {
  connId: string
  engine: string
  /** Existing table to edit, or null to design a new one */
  table: TableInfo | null
  /** Default schema for a new table (e.g. dbo, public) */
  defaultSchema?: string
  onStatus: (s: string) => void
  onOpenQuery: (title: string, text: string) => void
  /** Called after SQL ran, with the table (new tables get one) */
  onChanged: (table: TableInfo) => void
}

const NO_DDL = new Set(['mongodb', 'redis'])
let rowSeq = 0
type Row = DesignColumn & { key: number }
const toRows = (cols: ColumnInfo[]): Row[] => cols.map((c) => ({ ...c, original: c.name, key: ++rowSeq }))
const blank = (engine: string, first: boolean): Row => ({
  key: ++rowSeq, name: first ? 'id' : '', dataType: first ? (COMMON_TYPES[engine]?.[0] ?? 'integer') : (engine === 'mssql' ? 'nvarchar(255)' : COMMON_TYPES[engine]?.find((t) => /char|text|string/i.test(t)) ?? 'text'),
  nullable: !first, primaryKey: first, autoIncrement: first && engine !== 'clickhouse' && engine !== 'duckdb', defaultValue: ''
})

/** Edit columns and indexes; every change is shown as SQL before it runs. */
export function TableDesigner({ connId, engine, table, defaultSchema, onStatus, onOpenQuery, onChanged }: Props) {
  const { conn } = useConn()
  const isNew = !table
  const readOnly = NO_DDL.has(engine) || table?.type === 'view'
  const [structure, setStructure] = useState<TableStructure | null>(null)
  const [rows, setRows] = useState<Row[]>(() => (isNew ? [blank(engine, true), blank(engine, false)] : []))
  const [newName, setNewName] = useState('new_table')
  const [newSchema, setNewSchema] = useState(defaultSchema ?? '')
  const [dropIndexes, setDropIndexes] = useState<Set<string>>(new Set())
  const [addIndexes, setAddIndexes] = useState<{ name: string; columns: string[]; unique: boolean }[]>([])
  const [ixForm, setIxForm] = useState<{ columns: string[]; unique: boolean } | null>(null)
  const [review, setReview] = useState<{ sql: string[]; warnings: string[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!table) return
    setError('')
    try {
      const s = await window.db.getStructure(connId, table)
      setStructure(s); setRows(toRows(s.columns)); setDropIndexes(new Set()); setAddIndexes([])
    } catch (e) { setError(errMsg(e)) }
  }
  useEffect(() => { load() }, [connId, table?.schema, table?.name])

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const removeRow = (r: Row) => (r.original === undefined ? setRows((rs) => rs.filter((x) => x.key !== r.key)) : update(r.key, { dropped: !r.dropped }))

  const target: TableInfo = table ?? { schema: newSchema || undefined, name: newName.trim() }

  /** SQL for everything changed so far */
  const plan = useMemo(() => {
    if (readOnly) return { sql: [], warnings: [] }
    const live = rows.filter((r) => !r.dropped && r.name.trim())
    if (isNew) {
      if (!live.length) return { sql: [], warnings: ['Add at least one column.'] }
      return {
        sql: [createTableSql(engine, target, { columns: live }), ...addIndexes.map((ix) => createIndexSql(engine, target, ix.name, ix.columns, ix.unique))],
        warnings: []
      }
    }
    if (!structure) return { sql: [], warnings: [] }
    const alter = alterTableSql(engine, target, structure.columns, rows)
    return {
      sql: [
        ...[...dropIndexes].map((n) => dropIndexSql(engine, target, n)),
        ...alter.sql,
        ...addIndexes.map((ix) => createIndexSql(engine, target, ix.name, ix.columns, ix.unique))
      ],
      warnings: alter.warnings
    }
  }, [rows, structure, dropIndexes, addIndexes, newName, newSchema, readOnly])

  const dirty = plan.sql.length > 0 || (isNew && rows.length > 0)

  const apply = async () => {
    if (!review) return
    if (!allowRun(conn, checkSql(review.sql.join('\n'), 'sql'))) return
    setBusy(true); setError('')
    let done = 0
    try {
      // One statement at a time: some databases (e.g. SQLite) run only one per call
      for (const stmt of review.sql) { await window.db.queryMulti(connId, stmt); done++ }
      onStatus(isNew ? `Created ${target.name}` : `Applied ${done} change${done === 1 ? '' : 's'} to ${target.name}`)
      setReview(null)
      onChanged(target)
      if (!isNew) await load()
    } catch (e) {
      setError(`${errMsg(e)}${done ? ` (after ${done} of ${review.sql.length} statements ran)` : ''}`)
      setReview(null)
      if (!isNew && done) await load()
    } finally { setBusy(false) }
  }

  const columnNames = rows.filter((r) => !r.dropped && r.name.trim()).map((r) => r.name)
  const types = COMMON_TYPES[engine] ?? []
  const openTrigger = async (o: DbObject) => {
    try { onOpenQuery(o.name, await window.db.getDefinition(connId, o)) } catch (e) { setError(errMsg(e)) }
  }

  return (
    <div className="designer">
      <div className="toolbar">
        {isNew ? (
          <div className="designer-name">
            {engine !== 'sqlite' && engine !== 'libsql' && engine !== 'mysql' && (
              <input className="schema-input" value={newSchema} onChange={(e) => setNewSchema(e.target.value)} placeholder="schema" title="Schema" />
            )}
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Table name" autoFocus />
          </div>
        ) : (
          <div className="crumb">{table!.schema && <span className="muted">{table!.schema} / </span>}<strong>{table!.name}</strong> <span className="muted">· {readOnly ? 'columns' : 'design'}</span></div>
        )}
        <div className="spacer" />
        {!readOnly && <button className="btn btn-sm" onClick={() => setRows((rs) => [...rs, blank(engine, false)])}><IconPlus width={13} height={13} /> Column</button>}
        {!readOnly && !isNew && <button className="btn btn-sm" onClick={load} disabled={!dirty}>Discard</button>}
        {!readOnly && (
          <button className="btn btn-primary btn-sm" disabled={!plan.sql.length || (isNew && !newName.trim())}
            onClick={() => setReview({ sql: plan.sql, warnings: plan.warnings })}>
            {isNew ? 'Create table…' : `Review ${plan.sql.length || ''} change${plan.sql.length === 1 ? '' : 's'}…`}
          </button>
        )}
        {!isNew && <button className="icon-btn" title="Reload" onClick={load}><IconRefresh /></button>}
      </div>
      {error && <div className="notice error" onClick={() => setError('')}>{error}</div>}
      {!review && plan.warnings.length > 0 && <div className="notice warn">{plan.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}

      <div className="designer-body">
        <h4>Columns</h4>
        <table className="design-grid">
          <thead>
            <tr><th>Name</th><th>Type</th><th title="Allow NULL">Null</th><th title="Primary key">PK</th><th title="Auto increment / identity">Auto</th><th>Default</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const changed = r.original === undefined ? 'added' : r.dropped ? 'dropped' : (() => {
                const o = structure?.columns.find((c) => c.name === r.original)
                return o && (o.name !== r.name || o.dataType !== r.dataType || o.nullable !== r.nullable || (o.defaultValue ?? '') !== (r.defaultValue ?? '')) ? 'modified' : ''
              })()
              return (
                <tr key={r.key} className={isNew ? '' : changed}>
                  <td><input value={r.name} disabled={readOnly || r.dropped} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="column_name" /></td>
                  <td>
                    <TypeInput value={r.dataType} types={types} disabled={readOnly || r.dropped} onChange={(v) => update(r.key, { dataType: v })} />
                  </td>
                  <td className="c"><input type="checkbox" checked={r.nullable} disabled={readOnly || r.dropped || r.primaryKey} onChange={(e) => update(r.key, { nullable: e.target.checked })} /></td>
                  <td className="c">
                    {readOnly || !isNew
                      ? (r.primaryKey ? <IconKey className="pk" width={13} height={13} /> : null)
                      : <input type="checkbox" checked={r.primaryKey} onChange={(e) => update(r.key, { primaryKey: e.target.checked, nullable: e.target.checked ? false : r.nullable })} />}
                  </td>
                  <td className="c">
                    {readOnly || !isNew
                      ? (r.autoIncrement ? '✓' : '')
                      : <input type="checkbox" checked={!!r.autoIncrement} onChange={(e) => update(r.key, { autoIncrement: e.target.checked })} />}
                  </td>
                  <td><input value={r.defaultValue ?? ''} disabled={readOnly || r.dropped || r.autoIncrement} onChange={(e) => update(r.key, { defaultValue: e.target.value })} placeholder={readOnly ? '' : "e.g. 0, 'text', now()"} /></td>
                  <td className="c">
                    {!readOnly && (
                      <button className="icon-btn" title={r.dropped ? 'Keep column' : 'Remove column'} onClick={() => removeRow(r)}>
                        {r.dropped ? '↺' : <IconTrash width={14} height={14} />}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <h4>
          Indexes
          {!readOnly && <button className="btn btn-sm" onClick={() => setIxForm({ columns: [], unique: false })}><IconPlus width={12} height={12} /> Index</button>}
        </h4>
        {ixForm && (
          <div className="ix-form">
            <span className="muted">Columns:</span>
            {columnNames.map((c) => (
              <label key={c} className={`chip ${ixForm.columns.includes(c) ? 'on' : ''}`}>
                <input type="checkbox" checked={ixForm.columns.includes(c)}
                  onChange={(e) => setIxForm({ ...ixForm, columns: e.target.checked ? [...ixForm.columns, c] : ixForm.columns.filter((x) => x !== c) })} />
                {c}
              </label>
            ))}
            <label className="chip"><input type="checkbox" checked={ixForm.unique} onChange={(e) => setIxForm({ ...ixForm, unique: e.target.checked })} /> Unique</label>
            <button className="btn btn-sm btn-primary" disabled={!ixForm.columns.length} onClick={() => {
              const name = `${ixForm.unique ? 'ux' : 'ix'}_${target.name}_${ixForm.columns.join('_')}`.replace(/\W+/g, '_').slice(0, 60)
              setAddIndexes((l) => [...l, { name, ...ixForm }]); setIxForm(null)
            }}>Add</button>
            <button className="btn btn-sm" onClick={() => setIxForm(null)}>Cancel</button>
          </div>
        )}
        <div className="obj-list">
          {(structure?.indexes ?? []).map((ix) => (
            <div key={ix.name} className={`obj-item ${dropIndexes.has(ix.name) ? 'dropped' : ''}`}>
              {ix.primary ? <IconKey className="pk" width={13} height={13} /> : <span className="tag">{ix.unique ? 'UNIQUE' : 'INDEX'}</span>}
              <strong>{ix.name}</strong><span className="muted">({ix.columns.join(', ')})</span>
              <span className="spacer" />
              {!readOnly && !ix.primary && (
                <button className="icon-btn" title={dropIndexes.has(ix.name) ? 'Keep index' : 'Drop index'}
                  onClick={() => setDropIndexes((s) => { const n = new Set(s); n.has(ix.name) ? n.delete(ix.name) : n.add(ix.name); return n })}>
                  {dropIndexes.has(ix.name) ? '↺' : <IconTrash width={14} height={14} />}
                </button>
              )}
            </div>
          ))}
          {addIndexes.map((ix, i) => (
            <div key={`new${i}`} className="obj-item added">
              <span className="tag">{ix.unique ? 'UNIQUE' : 'INDEX'}</span><strong>{ix.name}</strong><span className="muted">({ix.columns.join(', ')})</span>
              <span className="spacer" />
              <button className="icon-btn" title="Remove" onClick={() => setAddIndexes((l) => l.filter((_, j) => j !== i))}><IconTrash width={14} height={14} /></button>
            </div>
          ))}
          {!structure?.indexes.length && !addIndexes.length && <div className="muted small-text">No indexes</div>}
        </div>

        {!isNew && (
          <>
            <h4>Foreign keys</h4>
            <div className="obj-list">
              {(structure?.foreignKeys ?? []).map((fk) => (
                <div key={fk.name} className="obj-item">
                  <span className="tag">FK</span><strong>{fk.name}</strong>
                  <span className="muted">({fk.columns.join(', ')}) → {fk.refSchema ? `${fk.refSchema}.` : ''}{fk.refTable} ({fk.refColumns.join(', ')})</span>
                </div>
              ))}
              {!structure?.foreignKeys.length && <div className="muted small-text">No foreign keys</div>}
            </div>
            {!NO_DDL.has(engine) && (
              <>
                <h4>Triggers</h4>
                <div className="obj-list">
                  {(structure?.triggers ?? []).map((t) => (
                    <div key={t.name} className="obj-item clickable" onClick={() => openTrigger(t)} title="Open the trigger script">
                      <IconCode width={13} height={13} /><strong>{t.name}</strong><span className="spacer" /><span className="muted small-text">Modify →</span>
                    </div>
                  ))}
                  {!structure?.triggers.length && <div className="muted small-text">No triggers</div>}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {review && (
        <div className="modal-backdrop" onMouseDown={() => !busy && setReview(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{isNew ? 'Create table' : 'Apply changes'}</h3>
            <p className="muted">This SQL will run on the database:</p>
            <pre className="sql-preview">{review.sql.join('\n\n')}</pre>
            {review.warnings.map((w, i) => <div key={i} className="notice warn">⚠ {w}</div>)}
            <div className="modal-actions">
              <button className="btn" onClick={() => { onOpenQuery(`${isNew ? 'Create' : 'Alter'} ${target.name}`, review.sql.join('\n\n')); setReview(null) }}>Open in editor</button>
              <div className="spacer" />
              <button className="btn" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? 'Running…' : 'Run'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
