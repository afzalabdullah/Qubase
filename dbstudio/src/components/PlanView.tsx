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

/** SQLite (and other indented text plans): one step per line, nesting by indent. No costs, so each step gets a rough weight. */
function fromText(text: string): Node | null {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length || lines.length > 500) return null
  const weight = (l: string) => /\bSCAN\b(?!.*USING (COVERING )?INDEX)/i.test(l) ? 10 : /TEMP B-TREE|SORT/i.test(l) ? 5 : /SEARCH|USING (COVERING )?INDEX|PRIMARY KEY/i.test(l) ? 1 : 0.5
  const root: Node = { label: 'Query', detail: 'Weights are estimated (this database reports no costs)', cost: 0, children: [] }
  const stack: { n: Node; indent: number }[] = [{ n: root, indent: -1 }]
  for (const l of lines) {
    const indent = l.search(/\S/)
    const label = l.trim().replace(/^[└├│|`\-─\s]+/, '')
    const n: Node = { label, detail: '', cost: weight(label), children: [] }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    stack[stack.length - 1].n.children.push(n)
    stack.push({ n, indent })
  }
  // Subtree cost = own weight + children, like the real planners report
  const sum = (n: Node): number => (n.cost = n.cost + n.children.reduce((a, c) => a + sum(c), 0))
  sum(root)
  return root
}

/** Plain-language advice from the plan's shape */
function tipsFor(tree: Node): { level: 'warn' | 'info'; text: string }[] {
  const out: { level: 'warn' | 'info'; text: string }[] = []
  const total = tree.cost || 1
  const seen = new Set<string>()
  const add = (level: 'warn' | 'info', text: string) => { if (!seen.has(text)) { seen.add(text); out.push({ level, text }) } }
  const walk = (n: Node) => {
    const l = n.label
    const self = Math.max(0, n.cost - n.children.reduce((a, c) => a + c.cost, 0))
    const on = /\bon\s+([\w.$#@"[\]]+)/i.exec(l)?.[1] ?? /\b(?:SCAN|SEARCH)\s+(?:TABLE\s+)?([\w.$#@"]+)/i.exec(l)?.[1] ?? ''
    if (/seq scan|table scan|clustered index scan|\bALL on\b|^SCAN\b(?!.*USING (COVERING )?INDEX)|full scan/i.test(l) && (n.rows === undefined || n.rows > 1000 || !n.rows))
      add('warn', `Reads every row of ${on || 'a table'}${n.rows ? ` (about ${Math.round(n.rows).toLocaleString()} rows)` : ''}. An index on the columns in WHERE or JOIN for this table can make it much faster.`)
    if (/\bsort\b|filesort|TEMP B-TREE/i.test(l + ' ' + n.detail))
      add('info', `Sorts rows${/ORDER BY|Sort Key/i.test(l + n.detail) ? ' for ORDER BY' : /GROUP|DISTINCT/i.test(l + n.detail) ? ' for GROUP BY / DISTINCT' : ''}. An index that matches the sort order lets the database skip this step.`)
    if (/temporary table|Using temporary/i.test(n.detail)) add('info', 'Builds a temporary table. Simplifying GROUP BY / DISTINCT or adding an index can avoid it.')
    if (/nested loop/i.test(l) && n.children.some((c) => (c.rows ?? 0) > 10000)) add('warn', 'Nested loop over many rows. Check that the joined columns have indexes.')
    if (/warnings/i.test(n.detail)) add('warn', 'SQL Server reported warnings on a step (for example a missing index or an implicit type conversion). See the raw plan for details.')
    if (/key lookup|rid lookup/i.test(l)) add('info', `Looks up extra columns row by row${on ? ` in ${on}` : ''}. Adding those columns to the index (INCLUDE) avoids it.`)
    if (self / total > 0.5 && n !== tree) add('warn', `“${l}” is ${(self / total * 100).toFixed(0)}% of the estimated cost. Start there.`)
    n.children.forEach(walk)
  }
  walk(tree)
  return out
}

/** Plan as boxes and arrows, top-down; box colour shows each step's share of the cost */
function PlanDiagram({ tree }: { tree: Node }) {
  const W = 220, H = 70, GX = 26, GY = 46
  const total = tree.cost || 1
  type P = { n: Node; x: number; y: number; self: number }
  const placed: P[] = []
  const links: [P, P][] = []
  let leaf = 0
  const place = (n: Node, depth: number): P => {
    const kids = n.children.map((c) => place(c, depth + 1))
    const x = kids.length ? (kids[0].x + kids[kids.length - 1].x) / 2 : leaf++ * (W + GX)
    const p = { n, x, y: depth * (H + GY), self: Math.max(0, n.cost - n.children.reduce((a, c) => a + c.cost, 0)) }
    placed.push(p)
    kids.forEach((k) => links.push([p, k]))
    return p
  }
  place(tree, 0)
  const width = Math.max(...placed.map((p) => p.x)) + W + 20
  const height = Math.max(...placed.map((p) => p.y)) + H + 20
  const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
  return (
    <div className="plan-diagram">
      <svg width={width} height={height}>
        <g transform="translate(10 10)">
          {links.map(([a, b], i) => <path key={i} className="pd-link" d={`M ${a.x + W / 2} ${a.y + H} C ${a.x + W / 2} ${a.y + H + GY / 2}, ${b.x + W / 2} ${b.y - GY / 2}, ${b.x + W / 2} ${b.y}`} />)}
          {placed.map((p, i) => {
            const share = p.self / total
            return (
              <g key={i} transform={`translate(${p.x} ${p.y})`} className={`pd-node ${share > 0.3 ? 'hot' : share > 0.1 ? 'warm' : ''}`}>
                <title>{`${p.n.label}\n${p.n.detail}\nSubtree cost ${p.n.cost}`}</title>
                <rect width={W} height={H} rx={8} />
                <rect width={Math.max(2, W * Math.min(1, share))} height={4} y={H - 4} className="pd-bar" />
                <text x={10} y={20} className="pd-label">{cut(p.n.label, 30)}</text>
                <text x={10} y={38} className="pd-detail">{cut(p.n.detail || ' ', 36)}</text>
                <text x={10} y={56} className="pd-num">{(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of cost{p.n.rows ? ` · ${Math.round(p.n.rows).toLocaleString()} rows` : ''}</text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function parse(r: ExplainResult): Node | null {
  try {
    if (r.format === 'text') return fromText(r.plan)
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
  const tips = useMemo(() => (tree ? tipsFor(tree) : []), [tree])
  const [mode, setMode] = useState<'tree' | 'diagram' | 'raw'>(() => { try { return (localStorage.getItem('planMode') as 'tree' | 'diagram') || 'tree' } catch { return 'tree' } })
  const raw = mode === 'raw'
  const setRaw = (r: boolean) => setMode(r ? 'raw' : 'tree')
  const pick = (m: 'tree' | 'diagram' | 'raw') => { setMode(m); try { if (m !== 'raw') localStorage.setItem('planMode', m) } catch { /* ignore */ } }
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
        <div className="seg-ctl">
          <button type="button" className={mode === 'tree' ? 'on' : ''} onClick={() => pick('tree')}>Tree</button>
          <button type="button" className={mode === 'diagram' ? 'on' : ''} onClick={() => pick('diagram')}>Diagram</button>
          <button type="button" onClick={() => setRaw(true)}>Raw</button>
        </div>
        <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(result.plan)}>Copy</button>
      </div>
      {tips.length > 0 && (
        <ul className="plan-tips">
          {tips.map((t, i) => <li key={i} className={t.level}><span className="tip-ico">{t.level === 'warn' ? '!' : 'i'}</span>{t.text}</li>)}
        </ul>
      )}
      {mode === 'diagram' ? <PlanDiagram tree={tree} /> : <div className="plan-rows">
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
      </div>}
    </div>
  )
}

function safePretty(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s }
}
