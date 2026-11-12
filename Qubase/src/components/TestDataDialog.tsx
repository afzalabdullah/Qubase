import { useState } from 'react'
import type { ColumnInfo, TableInfo } from '../../shared/types'
import { ColumnRule, isAutoColumn, RULE_LABELS, RuleKind, testDataSql } from '../testdata'
import { errMsg } from '../util'
import { IconX } from './Icons'

const RANGE: RuleKind[] = ['int', 'decimal', 'sequence']
const DATES: RuleKind[] = ['date', 'datetime']

/** Choose how each column is filled, then open the INSERT script in a query tab. */
export function TestDataDialog({ engine, table, columns, onOpenQuery, onClose }: {
  engine: string; table: TableInfo; columns: ColumnInfo[]
  onOpenQuery: (title: string, sql: string) => void; onClose: () => void
}) {
  const [rows, setRows] = useState(100)
  const [rules, setRules] = useState<Record<string, ColumnRule>>(() =>
    Object.fromEntries(columns.map((c) => [c.name, { kind: isAutoColumn(c) ? 'skip' : 'auto' } as ColumnRule])))
  const [error, setError] = useState('')
  const set = (name: string, p: Partial<ColumnRule>) => setRules((r) => ({ ...r, [name]: { ...r[name], ...p } }))

  const make = () => {
    try { onOpenQuery(`Test data: ${table.name}`, testDataSql(engine, table, columns, Math.max(1, Math.min(100000, rows)), rules)); onClose() }
    catch (e) { setError(errMsg(e)) }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal testdata-modal" role="dialog" aria-label="Generate test data">
        <div className="modal-head"><strong>Generate test data · {table.name}</strong><div className="spacer" /><button className="icon-btn" onClick={onClose}><IconX /></button></div>
        <div className="modal-body">
          <table className="testdata-table">
            <thead><tr><th>Column</th><th>Type</th><th>Fill with</th><th>Options</th><th title="Percent of rows left NULL">NULL %</th></tr></thead>
            <tbody>
              {columns.map((c) => {
                const r = rules[c.name]
                return (
                  <tr key={c.name}>
                    <td><strong>{c.name}</strong>{c.primaryKey && <span className="muted small-text"> PK</span>}</td>
                    <td className="muted small-text">{c.dataType}</td>
                    <td><select value={r.kind} onChange={(e) => set(c.name, { kind: e.target.value as RuleKind })}>{RULE_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td className="td-opts">
                      {RANGE.includes(r.kind) && <>
                        <input className="small-input" type="number" value={r.min ?? 1} onChange={(e) => set(c.name, { min: Number(e.target.value) })} title={r.kind === 'sequence' ? 'Start' : 'Min'} />
                        <input className="small-input" type="number" value={r.max ?? (r.kind === 'sequence' ? 1 : 1000)} onChange={(e) => set(c.name, { max: Number(e.target.value) })} title={r.kind === 'sequence' ? 'Step' : 'Max'} />
                      </>}
                      {DATES.includes(r.kind) && <>
                        <input type="date" value={r.from ?? ''} onChange={(e) => set(c.name, { from: e.target.value })} title="From" />
                        <input type="date" value={r.to ?? ''} onChange={(e) => set(c.name, { to: e.target.value })} title="To" />
                      </>}
                      {r.kind === 'list' && <input value={r.list ?? ''} placeholder="red, green, blue" onChange={(e) => set(c.name, { list: e.target.value })} />}
                      {r.kind === 'constant' && <input value={r.value ?? ''} placeholder="value" onChange={(e) => set(c.name, { value: e.target.value })} />}
                    </td>
                    <td>{!['auto', 'skip', 'null'].includes(r.kind) && c.nullable && <input className="small-input" type="number" min={0} max={100} value={r.nullPct ?? 0} onChange={(e) => set(c.name, { nullPct: Number(e.target.value) })} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {error && <div className="notice error">{error}</div>}
        </div>
        <div className="modal-foot">
          <label className="check">Rows <input className="small-input" type="number" min={1} max={100000} value={rows} onChange={(e) => setRows(Number(e.target.value) || 1)} /></label>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={make}>Create INSERT script</button>
        </div>
      </div>
    </div>
  )
}
