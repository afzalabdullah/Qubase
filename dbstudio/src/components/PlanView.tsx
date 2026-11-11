import { useMemo, useState } from 'react'
import type { ExplainResult } from '../../shared/types'

interface Node {
  label: string
  detail: string
  /** Cost of this step and everything below it */
  cost: number
  rows?: number
  children: Node[]
}

/** PostgreSQL EXPLAIN (FORMAT JSON) */
function fromPg(plan: unknown): Node | null {
  const root = Array.isArray(plan) ? (plan[0] as { Plan?: unknown })?.Plan : null
  if (!root) return null
  const walk = (p: Record<string, unknown>): Node => {
    const on = [p['Relation Name'] && `on ${p['Relation Name']}`, p['Index Name'] && `using ${p['Index Name']}`].filter(Boolean).join(' ')
    const cond = ['Index Cond', 'Filter', 'Hash Cond', 'Join Filter', 'Merge Cond', 'Sort Key', 'Group Key']
      .filter((k) => p[k]).map((k) => `${k}: ${Array.isArray(p[k]) ? (p[k] as string[]).join(', ') : p[k]}`).join(' · ')
    return {
      label: `${p['Node Type']}${p['Join Type'] ? ` (${p['Join Type']})` : ''} ${on}`.trim(),
      detail: cond,
      cost: Number(p['Total Cost'] ?? 0),
      rows: Number(p['Plan Rows'] ?? 0),
      children: ((p.Plans as Record<string, unknown>[]) ?? []).map(walk)
    }
  }
  return walk(root as Record<string, unknown>)
}

/** MySQL EXPLAIN FORMAT=JSON: nested objects; each table access becomes a step. */
function fromMysql(plan: unknown): Node | null {
  const qb = (plan as { query_block?: Record<string, unknown> })?.query_block
  if (!qb) return null
  const walk = (name: string, o: unknown): Node[] => {
    if (!o || typeof o !== 'object') return []
    if (Array.isArray(o)) return o.flatMap((x) => walk(name, x))
    const r = o as Record<string, unknown>
    if (name === 'table') {
      const ci = r.cost_info as Record<string, string> | undefined
      return [{
        label: `${String(r.access_type ?? 'scan').toUpperCase()} on ${r.table_name}${r.key ? ` using ${r.key}` : ''}`,
        detail: [r.attached_condition && `Filter: ${r.attached_condition}`, r.possible_keys && `Possible keys: ${(r.possible_keys as string[]).join(', ')}`].filter(Boolean).join(' · '),
        cost: Number(ci?.prefix_cost ?? ci?.read_cost ?? 0),
        rows: Number(r.rows_examined_per_scan ?? 0),
        children: []
      }]
    }
    const kids = Object.entries(r).flatMap(([k, v]) => (typeof v === 'object' ? walk(k, v) : []))
    if (['ordering_operation', 'grouping_operation', 'duplicates_removal', 'nested_loop', 'materialized_from_subquery'].includes(name)) {
      return [{ label: name.replace(/_/g, ' '), detail: r.using_filesort ? 'Using filesort' : r.using_temporary_table ? 'Using temporary table' : '', cost: Math.max(0, ...kids.map((k) => k.cost)), children: kids }]
    }
    return kids
  }
  const cost = Number((qb.cost_info as Record<string, string> | undefined)?.query_cost ?? 0)
  return { label: 'Query', detail: '', cost, children: walk('query_block', Object.fromEntries(Object.entries(qb).filter(([k]) => k !== 'cost_info'))) }
}

/** SQL Server showplan XML: RelOp elements nest the same way the plan does. */
function fromXml(xml: string): Node | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const first = doc.getElementsByTagNameNS('*', 'RelOp')[0]
  if (!first) return null
  // Only elements that belong to this step, not to a step nested inside it
  const own = (el: Element, tag: string) => Array.from(el.getElementsByTagNameNS('*', tag)).find((x) => {
    let p = x.parentElement
    while (p && p.localName !== 'RelOp') p = p.parentElement
    return p === el
  })
  const walk = (el: Element): Node => {
    const obj = own(el, 'Object')
    const on = obj ? `on ${[obj.getAttribute('Table'), obj.getAttribute('Index')].filter(Boolean).join('.').replace(/[[\]]/g, '')}` : ''
    const kids: Node[] = []
    // Direct RelOp descendants (not nested deeper inside another RelOp)
    const stack = [...Array.from(el.children)]
    while (stack.length) {
      const c = stack.shift()!
      if (c.localName === 'RelOp') kids.push(walk(c))
      else stack.unshift(...Array.from(c.children))
    }
    const warn = own(el, 'Warnings') ? ' · ⚠ warnings' : ''
    return {
      label: `${el.getAttribute('PhysicalOp')}${el.getAttribute('LogicalOp') !== el.getAttribute('PhysicalOp') ? ` (${el.getAttribute('LogicalOp')})` : ''} ${on}`.trim(),
      detail: `Est. rows ${Number(el.getAttribute('EstimateRows') ?? 0).toLocaleString()}${warn}`,
      cost: Number(el.getAttribute('EstimatedTotalSubtreeCost') ?? 0),
      rows: Number(el.getAttribute('EstimateRows') ?? 0),
      children: kids
    }
  }
  return walk(first)
}

function parse(r: ExplainResult): Node | null {
  try {
    if (r.format === 'xml') return fromXml(r.plan)
    if (r.format === 'json') {
      const j = JSON.parse(r.plan)
      return fromPg(j) ?? fromMysql(j)
    }
  } catch { /* fall back to raw text */ }
  return null
}

/** Query plan as a tree with cost bars; the costliest steps are highlighted. */
export function PlanView({ result }: { result: ExplainResult }) {
  const tree = useMemo(() => parse(result), [result])
  const [raw, setRaw] = useState(false)
  if (!tree || raw) {
    return (
      <div className="plan-view">
        {tree && <div className="plan-bar"><button className="btn btn-sm" onClick={() => setRaw(false)}>Show as tree</button></div>}
        <pre className="plan-raw">{result.format === 'json' ? safePretty(result.plan) : result.plan}</pre>
      </div>
    )
  }
  const total = tree.cost || 1
  // Self cost = subtree cost minus children; bars show each step's share of the total
  const rows: { n: Node; depth: number; self: number }[] = []
  const walk = (n: Node, depth: number) => {
    rows.push({ n, depth, self: Math.max(0, n.cost - n.children.reduce((a, c) => a + c.cost, 0)) })
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(tree, 0)
  return (
    <div className="plan-view">
      <div className="plan-bar">
        <span className="muted small-text">Estimated plan · total cost {tree.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => setRaw(true)}>Raw plan</button>
        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(result.plan)}>Copy</button>
      </div>
      <div className="plan-rows">
        {rows.map(({ n, depth, self }, i) => {
          const share = self / total
          return (
            <div key={i} className={`plan-row ${share > 0.3 ? 'hot' : share > 0.1 ? 'warm' : ''}`} style={{ paddingLeft: 10 + depth * 18 }}>
              <div className="plan-main">
                <span className="plan-label">{depth > 0 && '└ '}{n.label}</span>
                {n.detail && <span className="plan-detail">{n.detail}</span>}
              </div>
              <div className="plan-cost" title={`Subtree cost ${n.cost}`}>
                <div className="plan-meter"><div style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
                <span>{(share * 100).toFixed(share < 0.1 ? 1 : 0)}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function safePretty(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}
