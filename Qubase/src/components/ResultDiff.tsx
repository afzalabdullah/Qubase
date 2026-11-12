import { useMemo, useState } from 'react'
import type { QueryResult } from '../../shared/types'
import { cellText } from '../util'
import { IconX } from './Icons'

// A result pinned with "Pin for compare", kept until the app closes
let pinned: { name: string; result: QueryResult } | null = null
export const getPinned = () => pinned
export function setPinned(p: typeof pinned) { pinned = p; window.dispatchEvent(new Event('qubase:pinned')) }

type Row = Record<string, unknown>
const norm = (v: unknown) => (v === null || v === undefined ? '\u0000' : cellText(v))

/** Side-by-side differences between the pinned result (before) and this one (after). */
export function ResultDiff({ after, afterName, onClose }: { after: QueryResult; afterName: string; onClose: () => void }) {
  const before = pinned!
  const shared = after.columns.filter((c) => before.result.columns.includes(c))
  const [keys, setKeys] = useState<string[]>(shared.slice(0, 1))
  const [byPosition, setByPosition] = useState(false)
  const [show, setShow] = useState<'all' | 'changed' | 'added' | 'removed'>('all')

  const diff = useMemo(() => {
    const keyOf = (r: Row, i: number) => (byPosition ? String(i) : keys.map((k) => norm(r[k])).join('\u0001'))
    const old = new Map<string, Row>()
    before.result.rows.forEach((r, i) => old.set(keyOf(r, i), r))
    const out: { kind: 'changed' | 'added' | 'removed'; a?: Row; b?: Row; cols: string[] }[] = []
    let same = 0
    after.rows.forEach((r, i) => {
      const k = keyOf(r, i)
      const o = old.get(k)
      if (!o) { out.push({ kind: 'added', b: r, cols: [] }); return }
      old.delete(k)
      const cols = shared.filter((c) => norm(o[c]) !== norm(r[c]))
      if (cols.length) out.push({ kind: 'changed', a: o, b: r, cols }); else same++
    })
    for (const o of old.values()) out.push({ kind: 'removed', a: o, cols: [] })
    return { out, same }
  }, [before, after, keys, byPosition, shared])

  const count = (k: string) => diff.out.filter((d) => d.kind === k).length
  const visible = diff.out.filter((d) => show === 'all' || d.kind === show).slice(0, 2000)
  const cell = (v: unknown) => (v === null || v === undefined ? <span className="null">NULL</span> : cellText(v))
  const added = after.columns.filter((c) => !before.result.columns.includes(c))
  const removed = before.result.columns.filter((c) => !after.columns.includes(c))

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal diff-modal" role="dialog" aria-label="Compare results">
        <div className="modal-head">
          <strong>Compare results</strong>
          <span className="muted small-text">before: {before.name} · after: {afterName}</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close"><IconX /></button>
        </div>
        <div className="toolbar wrap small-text">
          <span>Match rows by:</span>
          <label className="chip"><input type="checkbox" checked={byPosition} onChange={(e) => setByPosition(e.target.checked)} />row position</label>
          {!byPosition && shared.map((c) => (
            <label key={c} className={`chip ${keys.includes(c) ? 'on' : ''}`}>
              <input type="checkbox" checked={keys.includes(c)} onChange={(e) => setKeys((k) => (e.target.checked ? [...k, c] : k.filter((x) => x !== c)))} />{c}
            </label>
          ))}
        </div>
        {(added.length > 0 || removed.length > 0) && (
          <div className="notice small">{added.length ? `New columns: ${added.join(', ')}. ` : ''}{removed.length ? `Columns no longer there: ${removed.join(', ')}.` : ''} Only shared columns are compared.</div>
        )}
        <div className="result-tabs">
          {([['all', 'All differences', diff.out.length], ['changed', 'Changed', count('changed')], ['added', 'New rows', count('added')], ['removed', 'Removed rows', count('removed')]] as const).map(([id, label, n]) => (
            <button key={id} className={show === id ? 'on' : ''} onClick={() => setShow(id)}>{label} <span className="badge">{n}</span></button>
          ))}
          <span className="muted small-text pad-l">{diff.same.toLocaleString()} identical</span>
        </div>
        <div className="dc-grid-wrap diff-body">
          {diff.out.length === 0 ? <div className="placeholder ok">✓ The results are the same.</div> : (
            <table className="dc-grid">
              <thead><tr><th /><th>Side</th>{shared.map((c) => <th key={c} className={keys.includes(c) && !byPosition ? 'key' : ''}>{c}</th>)}</tr></thead>
              <tbody>
                {visible.map((d, i) => d.kind === 'changed' ? [
                  <tr key={i + 'a'} className="dc-changed first"><td rowSpan={2}><span className="diff-tag changed">Changed</span></td><td className="muted">before</td>
                    {shared.map((c) => <td key={c} className={d.cols.includes(c) ? 'diff-cell old' : ''}>{cell(d.a![c])}</td>)}</tr>,
                  <tr key={i + 'b'} className="dc-changed"><td className="muted">after</td>
                    {shared.map((c) => <td key={c} className={d.cols.includes(c) ? 'diff-cell' : ''}>{cell(d.b![c])}</td>)}</tr>
                ] : (
                  <tr key={i} className={d.kind === 'added' ? 'dc-source' : 'dc-target'}>
                    <td><span className={`diff-tag ${d.kind === 'added' ? 'missing' : 'extra'}`}>{d.kind === 'added' ? 'New' : 'Removed'}</span></td>
                    <td className="muted">{d.kind === 'added' ? 'after' : 'before'}</td>
                    {shared.map((c) => <td key={c}>{cell((d.a ?? d.b)![c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
