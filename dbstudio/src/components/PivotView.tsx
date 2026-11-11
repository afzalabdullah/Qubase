import { useMemo, useState } from 'react'
import type { QueryResult } from '../../shared/types'
import { cellText } from '../util'
import { fmtNum } from '../copyFormats'

type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'

/** Pivot table of the result: rows by one column, columns by another, a value aggregated in each cell. */
export function PivotView({ result, order }: { result: QueryResult; order: number[] }) {
  const cols = result.columns
  const numeric = cols.filter((c) => order.slice(0, 200).some((i) => typeof result.rows[i][c] === 'number'))
  const [rowBy, setRowBy] = useState(cols[0] ?? '')
  const [colBy, setColBy] = useState(cols.length > 2 ? cols[1] : '')
  const [value, setValue] = useState(numeric[0] ?? '')
  const [agg, setAgg] = useState<Agg>(numeric.length ? 'sum' : 'count')

  const table = useMemo(() => {
    const key = (v: unknown) => (v === null || v === undefined ? '(empty)' : cellText(v))
    const rowKeys = new Map<string, number>(), colKeys = new Map<string, number>()
    const cells = new Map<string, number[]>()
    for (const i of order) {
      const r = result.rows[i]
      const rk = key(r[rowBy]), ck = colBy ? key(r[colBy]) : 'Total'
      rowKeys.set(rk, (rowKeys.get(rk) ?? 0) + 1); colKeys.set(ck, (colKeys.get(ck) ?? 0) + 1)
      const v = agg === 'count' ? 1 : Number(r[value])
      if (agg !== 'count' && !Number.isFinite(v)) continue
      const k = `${rk}\u0001${ck}`
      if (!cells.has(k)) cells.set(k, [])
      cells.get(k)!.push(v)
    }
    const calc = (xs?: number[]) => {
      if (!xs?.length) return null
      switch (agg) {
        case 'count': return xs.length
        case 'sum': return xs.reduce((a, b) => a + b, 0)
        case 'avg': return xs.reduce((a, b) => a + b, 0) / xs.length
        case 'min': return Math.min(...xs)
        case 'max': return Math.max(...xs)
      }
    }
    const sortKeys = (m: Map<string, number>) => [...m.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const rk = sortKeys(rowKeys).slice(0, 500), ck = sortKeys(colKeys).slice(0, 50)
    const grid = rk.map((r) => ck.map((c) => calc(cells.get(`${r}\u0001${c}`))))
    const rowTotal = rk.map((r) => calc(ck.flatMap((c) => cells.get(`${r}\u0001${c}`) ?? [])))
    const colTotal = ck.map((c) => calc(rk.flatMap((r) => cells.get(`${r}\u0001${c}`) ?? [])))
    const all = calc([...cells.values()].flat())
    return { rk, ck, grid, rowTotal, colTotal, all, cut: rowKeys.size > 500 || colKeys.size > 50 }
  }, [result, order, rowBy, colBy, value, agg])

  const pick = (v: string, set: (s: string) => void, list: string[], none?: string) => (
    <select value={v} onChange={(e) => set(e.target.value)}>
      {none !== undefined && <option value="">{none}</option>}
      {list.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  )
  const show = (n: number | null) => (n === null ? '' : fmtNum(n))

  return (
    <div className="pivot">
      <div className="toolbar wrap small-text">
        <span>Rows</span>{pick(rowBy, setRowBy, cols)}
        <span>Columns</span>{pick(colBy, setColBy, cols, '(none)')}
        <span>Value</span>
        <select value={agg} onChange={(e) => setAgg(e.target.value as Agg)}>
          <option value="count">Count of rows</option>
          {numeric.length > 0 && <><option value="sum">Sum of</option><option value="avg">Average of</option><option value="min">Min of</option><option value="max">Max of</option></>}
        </select>
        {agg !== 'count' && pick(value, setValue, numeric)}
        {table.cut && <span className="muted">Showing the first 500 rows × 50 columns</span>}
      </div>
      <div className="pivot-wrap">
        <table className="pivot-table">
          <thead><tr><th>{rowBy}{colBy ? ` \\ ${colBy}` : ''}</th>{table.ck.map((c) => <th key={c}>{c}</th>)}{colBy && <th className="total">Total</th>}</tr></thead>
          <tbody>
            {table.rk.map((r, i) => (
              <tr key={r}><th>{r}</th>{table.grid[i].map((v, j) => <td key={j}>{show(v)}</td>)}{colBy && <td className="total">{show(table.rowTotal[i])}</td>}</tr>
            ))}
          </tbody>
          <tfoot><tr><th>Total</th>{table.colTotal.map((v, j) => <td key={j}>{show(v)}</td>)}{colBy && <td className="total">{show(table.all)}</td>}</tr></tfoot>
        </table>
      </div>
    </div>
  )
}
