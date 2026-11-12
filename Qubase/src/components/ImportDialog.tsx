import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo, ImportData, RowChange, TableInfo } from '../../shared/types'
import { IconUpload, IconX } from './Icons'
import { errMsg } from '../util'
import { allowRun } from '../safety'
import { useConn } from '../settings'
import { quoteIdent } from '../smartComplete'

const BATCH = 500
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const DEFAULT_SCHEMA: Record<string, string> = { mssql: 'dbo', postgres: 'public' }

type Kind = 'int' | 'bigint' | 'decimal' | 'bool' | 'date' | 'datetime' | 'text'
/** Type names per engine */
const TYPES: Record<string, Record<Kind, (len: number) => string>> = {
  mssql: { int: () => 'INT', bigint: () => 'BIGINT', decimal: () => 'DECIMAL(18, 4)', bool: () => 'BIT', date: () => 'DATE', datetime: () => 'DATETIME2', text: (n) => (n > 4000 ? 'NVARCHAR(MAX)' : `NVARCHAR(${n})`) },
  postgres: { int: () => 'INTEGER', bigint: () => 'BIGINT', decimal: () => 'NUMERIC', bool: () => 'BOOLEAN', date: () => 'DATE', datetime: () => 'TIMESTAMP', text: () => 'TEXT' },
  mysql: { int: () => 'INT', bigint: () => 'BIGINT', decimal: () => 'DECIMAL(18, 4)', bool: () => 'TINYINT(1)', date: () => 'DATE', datetime: () => 'DATETIME', text: (n) => (n > 16000 ? 'LONGTEXT' : `VARCHAR(${n})`) },
  oracle: { int: () => 'NUMBER(10)', bigint: () => 'NUMBER(19)', decimal: () => 'NUMBER', bool: () => 'NUMBER(1)', date: () => 'DATE', datetime: () => 'TIMESTAMP', text: (n) => (n > 4000 ? 'CLOB' : `VARCHAR2(${n})`) },
  sqlite: { int: () => 'INTEGER', bigint: () => 'INTEGER', decimal: () => 'REAL', bool: () => 'INTEGER', date: () => 'TEXT', datetime: () => 'TEXT', text: () => 'TEXT' },
  duckdb: { int: () => 'INTEGER', bigint: () => 'BIGINT', decimal: () => 'DOUBLE', bool: () => 'BOOLEAN', date: () => 'DATE', datetime: () => 'TIMESTAMP', text: () => 'VARCHAR' },
  clickhouse: { int: () => 'Nullable(Int32)', bigint: () => 'Nullable(Int64)', decimal: () => 'Nullable(Float64)', bool: () => 'Nullable(Bool)', date: () => 'Nullable(Date)', datetime: () => 'Nullable(DateTime)', text: () => 'Nullable(String)' }
}
TYPES.libsql = TYPES.sqlite

/** Best column type for the values in a file column */
function guess(values: unknown[]): { kind: Kind; len: number } {
  const v = values.filter((x) => x !== null && x !== undefined && x !== '').slice(0, 2000)
  const s = v.map((x) => (x instanceof Date ? x.toISOString() : String(x).trim()))
  const len = Math.max(1, ...s.map((x) => x.length))
  const roundLen = len <= 50 ? 50 : len <= 255 ? 255 : len <= 1000 ? 1000 : len <= 4000 ? 4000 : 100000
  if (!s.length) return { kind: 'text', len: 255 }
  if (s.every((x) => /^-?\d{1,18}$/.test(x) && !/^-?0\d/.test(x))) return { kind: s.some((x) => Math.abs(Number(x)) > 2147483647) ? 'bigint' : 'int', len }
  if (s.every((x) => /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(x))) return { kind: 'decimal', len }
  if (s.every((x) => /^(true|false)$/i.test(x)) || v.every((x) => typeof x === 'boolean')) return { kind: 'bool', len }
  if (s.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) return { kind: 'date', len }
  if (s.every((x) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(x))) return { kind: 'datetime', len }
  return { kind: 'text', len: roundLen }
}

/** Safe column name from a file header */
const colName = (h: string, i: number) => (h.trim().replace(/\s+/g, '_').replace(/[^\w]/g, '') || `column_${i + 1}`)

interface NewCol { file: string; name: string; type: string; include: boolean }

/**
 * Import rows from CSV, Excel or JSON. With a table: match file columns to its columns.
 * Without one: create a new table, guessing column types from the data.
 */
export function ImportDialog({ table, columns = [], onClose, onDone }: { table?: TableInfo; columns?: ColumnInfo[]; onClose: () => void; onDone: (n: number, table: TableInfo) => void }) {
  const { conn, connId, engine } = useConn()
  const isNew = !table
  const [file, setFile] = useState('')
  const [data, setData] = useState<ImportData | null>(null)
  const [map, setMap] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [schema, setSchema] = useState(DEFAULT_SCHEMA[engine] ?? '')
  const [schemas, setSchemas] = useState<string[]>([])
  const [newCols, setNewCols] = useState<NewCol[]>([])
  const [emptyFirst, setEmptyFirst] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const types = TYPES[engine] ?? TYPES.postgres

  useEffect(() => {
    if (!isNew) return
    window.db.listTables(connId).then((ts) => {
      const s = [...new Set(ts.map((t) => t.schema).filter(Boolean))] as string[]
      setSchemas(s)
      if (s.length && !s.includes(schema)) setSchema(s[0])
    }).catch(() => {})
  }, [connId, isNew]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => {
    setError('')
    const f = await window.db.pickFile('data')
    if (!f) return
    setBusy(true)
    try {
      const d = await window.db.readImportFile(f)
      setFile(f); setData(d)
      if (isNew) {
        setNewName(colName(f.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ''), 0).toLowerCase())
        setNewCols(d.columns.map((c, i) => { const g = guess(d.rows.map((r) => r[c])); return { file: c, name: colName(c, i), type: types[g.kind](g.len), include: true } }))
      } else {
        // Match by name, ignoring case and punctuation; auto-increment columns are left to the database
        const byName = new Map(d.columns.map((c) => [norm(c), c]))
        setMap(Object.fromEntries(columns.map((c) => [c.name, c.autoIncrement ? '' : byName.get(norm(c.name)) ?? ''])))
      }
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  const mapped: [string, string][] = isNew ? newCols.filter((c) => c.include).map((c) => [c.name, c.file]) : Object.entries(map).filter(([, src]) => src)
  const target: TableInfo | null = isNew ? (newName.trim() ? { name: newName.trim(), schema: schema || undefined, type: 'table' } : null) : table!
  const dupNames = isNew && new Set(newCols.filter((c) => c.include).map((c) => c.name.toLowerCase())).size !== newCols.filter((c) => c.include).length
  const createSql = useMemo(() => {
    if (!isNew || !target) return ''
    const q = (s: string) => quoteIdent(engine, s)
    const full = (target.schema ? `${q(target.schema)}.` : '') + q(target.name)
    const body = newCols.filter((c) => c.include).map((c) => `  ${q(c.name)} ${c.type}`).join(',\n')
    return `CREATE TABLE ${full} (\n${body}\n)${engine === 'clickhouse' ? ' ENGINE = MergeTree ORDER BY tuple()' : ''}`
  }, [isNew, target?.name, target?.schema, newCols, engine]) // eslint-disable-line react-hooks/exhaustive-deps

  const convert = (v: unknown, type?: string) => {
    if (v === '' || v === undefined) return null
    if (type && /BIT|BOOL|TINYINT\(1\)|NUMBER\(1\)/i.test(type) && typeof v === 'string' && /^(true|false)$/i.test(v)) return /^true$/i.test(v) ? (engine === 'postgres' || engine === 'duckdb' ? true : 1) : (engine === 'postgres' || engine === 'duckdb' ? false : 0)
    return v
  }

  const run = async () => {
    if (!data || !mapped.length || !target) return
    const what = isNew ? `create ${target.name} and import ${data.rows.length.toLocaleString()} rows` : `${emptyFirst ? 'delete all rows of ' + target.name + ', then ' : ''}import ${data.rows.length.toLocaleString()} rows into ${target.name}`
    if (!allowRun(conn, { what })) return
    if (!isNew && emptyFirst && !window.confirm(`Delete every row in ${target.name} before importing? This can't be undone.`)) return
    setBusy(true); setError('')
    let done = 0
    try {
      if (isNew) await window.db.query(connId, createSql)
      else if (emptyFirst) await window.db.query(connId, `DELETE FROM ${(target.schema ? quoteIdent(engine, target.schema) + '.' : '') + quoteIdent(engine, target.name)}`)
      const typeOf = Object.fromEntries(newCols.map((c) => [c.name, c.type]))
      for (let i = 0; i < data.rows.length; i += BATCH) {
        const changes: RowChange[] = data.rows.slice(i, i + BATCH).map((r) => ({
          op: 'insert', table: target,
          values: Object.fromEntries(mapped.map(([col, src]) => [col, convert(r[src], typeOf[col])]))
        }))
        await window.db.applyChanges(connId, changes)
        done += changes.length
        setProgress({ done, total: data.rows.length })
      }
      onDone(done, target)
      onClose()
    } catch (e) {
      // Each batch is its own transaction, so earlier batches stay imported
      setError(done || !isNew
        ? `Stopped after ${done.toLocaleString()} rows (rows ${done + 1}–${Math.min(done + BATCH, data.rows.length)} failed): ${errMsg(e)}`
        : `Could not create the table: ${errMsg(e)}`)
      if (done) onDone(done, target)
    } finally { setBusy(false) }
  }

  const preview = data?.rows.slice(0, 5) ?? []
  const typeChoices = [...new Set([...Object.values(types).map((f) => f(255)), ...newCols.map((c) => c.type)])]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal import-modal" role="dialog" aria-label="Import data">
        <div className="modal-head">
          <IconUpload /><strong>{isNew ? 'Import a file into a new table' : `Import into ${table!.name}`}</strong>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} disabled={busy} title="Close"><IconX /></button>
        </div>
        <div className="modal-body">
          <div className="import-steps">
            <span className={data ? 'done' : 'on'}>1 · Choose file</span>
            <span className={data ? 'on' : ''}>2 · {isNew ? 'Name and columns' : 'Match columns'}</span>
            <span className={progress ? 'on' : ''}>3 · Import</span>
          </div>
          <div className="import-file">
            <button className="btn" onClick={pick} disabled={busy}>{data ? 'Choose another file…' : 'Choose file…'}</button>
            <span className="muted small-text">{file || 'CSV, TSV, Excel (.xlsx, first sheet) or JSON array'}</span>
          </div>
          {data && (
            <>
              <p className="small-text">{data.rows.length.toLocaleString()} rows · {data.columns.length} columns in the file.</p>
              {preview.length > 0 && (
                <div className="import-preview">
                  <table className="grid"><thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{preview.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c}>{r[c] === null || r[c] === undefined ? <span className="muted">NULL</span> : String(r[c]).slice(0, 60)}</td>)}</tr>)}</tbody></table>
                </div>
              )}
              {isNew ? (
                <>
                  <div className="import-target">
                    {schemas.length > 0 && <label className="field"><span>Schema</span><select value={schema} onChange={(e) => setSchema(e.target.value)}>{schemas.map((s) => <option key={s}>{s}</option>)}</select></label>}
                    <label className="field"><span>New table name</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. customers_2026" /></label>
                  </div>
                  <p className="small-text muted">Types are guessed from the data; change any you like. Untick a column to leave it out.</p>
                  <div className="import-map">
                    {newCols.map((c, i) => (
                      <div key={c.file} className="map-row new">
                        <input type="checkbox" checked={c.include} onChange={(e) => setNewCols((cs) => cs.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} title="Include this column" />
                        <input value={c.name} onChange={(e) => setNewCols((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={!c.include} />
                        <select value={c.type} onChange={(e) => setNewCols((cs) => cs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} disabled={!c.include}>
                          {typeChoices.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <span className="map-sample muted small-text">{String(data.rows[0]?.[c.file] ?? 'NULL').slice(0, 30)}</span>
                      </div>
                    ))}
                  </div>
                  {dupNames && <div className="notice error">Two columns have the same name.</div>}
                  <details className="small-text"><summary>SQL that will create the table</summary><pre className="sql-preview">{createSql}</pre></details>
                </>
              ) : (
                <>
                  <p className="small-text">Pick which file column fills each table column; unmapped columns use their default.</p>
                  <div className="import-map">
                    {columns.map((c) => (
                      <label key={c.name} className="map-row">
                        <span className="map-col">{c.name} <span className="muted small-text">{c.dataType}{c.primaryKey ? ' · PK' : ''}{c.autoIncrement ? ' · auto' : ''}</span></span>
                        <select value={map[c.name] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [c.name]: e.target.value }))}>
                          <option value="">(skip)</option>
                          {data.columns.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <span className="map-sample muted small-text">{map[c.name] ? String(data.rows[0]?.[map[c.name]] ?? 'NULL').slice(0, 40) : ''}</span>
                      </label>
                    ))}
                  </div>
                  <label className="check small-text"><input type="checkbox" checked={emptyFirst} onChange={(e) => setEmptyFirst(e.target.checked)} /> Delete the table's existing rows first (replace the data)</label>
                </>
              )}
            </>
          )}
          {progress && <div className="import-progress"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /><span>{progress.done.toLocaleString()} / {progress.total.toLocaleString()}</span></div>}
          {error && <div className="notice error">{error}</div>}
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={run} disabled={busy || !data || !mapped.length || !target || dupNames}>
            {busy && progress ? 'Importing…' : isNew ? `Create table and import ${data ? data.rows.length.toLocaleString() : ''} rows` : `Import ${data ? data.rows.length.toLocaleString() : ''} rows`}
          </button>
        </div>
      </div>
    </div>
  )
}
