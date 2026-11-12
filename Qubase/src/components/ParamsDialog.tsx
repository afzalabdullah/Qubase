import { useState } from 'react'
import { fillParams, ParamValue, readParamValues, writeParamValues } from '../params'
import { IconX } from './Icons'

/** Asks for the value of each :name in the query, then hands back the filled-in SQL */
export function ParamsDialog({ sql, names, onRun, onClose }: { sql: string; names: string[]; onRun: (filled: string) => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, ParamValue>>(() => {
    const last = readParamValues()
    return Object.fromEntries(names.map((n) => [n, last[n] ?? { value: '', raw: false }]))
  })
  const set = (n: string, p: Partial<ParamValue>) => setValues((v) => ({ ...v, [n]: { ...v[n], ...p } }))
  const preview = fillParams(sql, values)
  const run = () => { writeParamValues(values); onRun(preview) }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="modal params-modal" role="dialog" aria-label="Query parameters" onSubmit={(e) => { e.preventDefault(); run() }}>
        <div className="modal-head">
          <strong>Query parameters</strong>
          <div className="spacer" />
          <button type="button" className="icon-btn" onClick={onClose} title="Close"><IconX /></button>
        </div>
        <div className="modal-body">
          {names.map((n, i) => (
            <div key={n} className="param-row">
              <label htmlFor={`p-${n}`}><code>:{n}</code></label>
              <input id={`p-${n}`} autoFocus={i === 0} value={values[n].value} onChange={(e) => set(n, { value: e.target.value })} placeholder="value, or NULL" />
              <label className="check small-text" title="Insert the text exactly as typed (for lists, column names or expressions)">
                <input type="checkbox" checked={values[n].raw} onChange={(e) => set(n, { raw: e.target.checked })} /> as SQL
              </label>
            </div>
          ))}
          <p className="muted small-text">Numbers and NULL are used as they are; other values are quoted. Values are remembered for next time.</p>
          <pre className="param-preview">{preview.length > 1500 ? preview.slice(0, 1500) + '…' : preview}</pre>
        </div>
        <div className="modal-foot">
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Run</button>
        </div>
      </form>
    </div>
  )
}
