import type { ReactNode } from 'react'

/* Small pictures of each feature, shown one at a time in the feature tour.
   They use the page theme tokens so they follow light and dark. */

const Kw = ({ children }: { children: ReactNode }) => <span className="font-semibold text-ember-text">{children}</span>

function TableCard({ name, cols, className }: { name: string; cols: [string, boolean?][]; className: string }) {
  return (
    <div className={`absolute w-40 overflow-hidden rounded-lg border border-line bg-surface text-xs shadow-sm ${className}`}>
      <div className="bg-slate px-3 py-1.5 font-semibold text-white">{name}</div>
      {cols.map(([c, on]) => <div key={c} className={`px-3 py-1 ${on ? 'bg-ember/10 font-medium text-fg' : 'text-muted'}`}>{on ? '✓ ' : ''}{c}</div>)}
    </div>
  )
}

export function QueryBuilderPreview() {
  return (
    <div className="relative h-[240px] w-[400px] shrink-0 max-sm:-mx-14 max-sm:scale-[0.68]">
      <svg className="absolute inset-0 size-full" viewBox="0 0 400 240" aria-hidden="true">
        <g fill="none" stroke="#ee5a0a" strokeWidth="2">
          <path d="M160 49 C200 49 200 65 240 65" /><path d="M320 112 C320 193 300 193 280 193" strokeDasharray="6 5" />
        </g>
        <g fill="#ee5a0a"><circle cx="160" cy="49" r="3" /><circle cx="240" cy="65" r="3" /><circle cx="280" cy="193" r="3" /></g>
      </svg>
      <TableCard name="customers" cols={[['id'], ['city', true], ['name']]} className="top-[8px] left-0" />
      <TableCard name="orders" cols={[['id'], ['customer_id'], ['ordered_at']]} className="top-0 left-[240px]" />
      <TableCard name="products" cols={[['id'], ['price', true], ['category']]} className="top-[128px] left-[120px]" />
    </div>
  )
}

function Field({ k, v, active }: { k: string; v: string; active?: boolean }) {
  return (
    <div className={`rounded-lg border bg-surface px-3 py-2 ${active ? 'border-ember' : 'border-line'}`}>
      <div className="text-xs text-muted">{k}</div><div className="font-medium">{v}</div>
    </div>
  )
}

export function SchedulePreview() {
  return (
    <div className="grid w-full max-w-md grid-cols-2 gap-2 text-sm">
      <Field k="Connection" v="Production DB" /><Field k="Database" v="sales" active />
      <Field k="Repeat" v="Weekdays at 08:00" /><Field k="Save as" v="Excel (.xlsx)" />
      <div className="col-span-2 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs">
        <Kw>SELECT</Kw> region, <Kw>SUM</Kw>(amount) <Kw>FROM</Kw> ord<span className="ml-1 rounded border border-ember px-1">orders</span>
      </div>
    </div>
  )
}

export function ErPreview() {
  const tables = [{ x: 10, y: 20, n: 'users', c: ['id', 'email'] }, { x: 210, y: 95, n: 'orders', c: ['id', 'user_id', 'total'] }, { x: 200, y: 10, n: 'invoices', c: ['id', 'order_id'] }]
  return (
    <svg viewBox="0 0 330 210" className="h-60 w-full max-w-md" role="img" aria-label="Three tables joined by foreign keys">
      <g fill="none" stroke="#ee5a0a" strokeWidth="2"><path d="M120 50 H170 V120 H210" /><path d="M320 130 H325 V40 H310" /></g>
      {tables.map((t) => (
        <g key={t.n} transform={`translate(${t.x} ${t.y})`}>
          <rect width="110" height={28 + t.c.length * 20} rx="6" fill="var(--surface)" stroke="var(--line)" />
          <rect width="110" height="24" rx="6" fill="#3a3e45" />
          <text x="10" y="17" fill="#ffffff" fontSize="12" fontWeight="600">{t.n}</text>
          {t.c.map((c, i) => <text key={c} x="10" y={42 + i * 20} fill="var(--muted)" fontSize="11">{c}</text>)}
        </g>
      ))}
    </svg>
  )
}

export function EditorPreview() {
  return (
    <div className="font-mono text-sm leading-7">
      <div><Kw>SELECT</Kw> o.id, o.<span className="rounded bg-ember/15 px-0.5">to</span><span className="caret inline-block h-4 w-1.5 translate-y-0.5 bg-ember" /></div>
      <div className="ml-20 w-48 overflow-hidden rounded-md border border-line bg-surface text-xs shadow-md">
        {[['total', 'numeric'], ['total_tax', 'numeric'], ['to_ship', 'bool']].map(([c, t], i) => (
          <div key={c} className={`flex justify-between px-2.5 py-0.5 ${i === 0 ? 'bg-ember/15 text-fg' : 'text-muted'}`}><span>{c}</span><span>{t}</span></div>
        ))}
      </div>
    </div>
  )
}

export function ComparePreview() {
  const rows: [string, string, string, string][] = [
    ['users', '=', 'Same', 'text-muted'], ['orders', '~', 'Changed', 'text-amber-600 dark:text-amber-400'],
    ['invoices', '+', 'Only in production', 'text-emerald-600 dark:text-emerald-400'], ['legacy_log', '−', 'Only in staging', 'text-rose-600 dark:text-rose-400'],
  ]
  return (
    <div className="grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
      <div className="text-xs text-muted">Staging</div><div /><div className="text-xs text-muted">Production</div>
      {rows.map(([t, s, label, c]) => (
        <div key={t} className="contents">
          <div className={`rounded-md border border-line bg-surface px-2.5 py-1 ${s === '+' ? 'opacity-35' : ''}`}>{t}</div>
          <div className={`font-mono font-semibold ${c}`} title={label}>{s}</div>
          <div className={`rounded-md border border-line bg-surface px-2.5 py-1 ${s === '−' ? 'opacity-35' : ''}`}>{t}</div>
        </div>
      ))}
    </div>
  )
}

export function ChartPreview() {
  const bars = [40, 65, 52, 80, 70, 95, 88]
  return (
    <div className="flex h-40 w-full max-w-md items-end gap-2.5 border-b border-line" role="img" aria-label="Bar chart of weekly sales">
      {bars.map((h, i) => <div key={i} className={`flex-1 rounded-t-sm ${i === 5 ? 'bg-ember' : 'bg-slate/70 dark:bg-[#5b616c]'}`} style={{ height: `${h}%` }} />)}
    </div>
  )
}

export function ImportPreview() {
  return (
    <div className="flex items-center gap-4 text-xs font-semibold">
      {[['XLSX', 'bg-emerald-700'], ['CSV', 'bg-sky-700'], ['JSON', 'bg-violet-700']].map(([l, c]) => (
        <div key={l} className={`grid h-16 w-12 place-items-end rounded-md ${c} p-1.5 text-white shadow-sm`}>{l}</div>
      ))}
      <span className="text-lg text-muted" aria-hidden="true">⇄</span>
      <img src="/icon.png" alt="" className="size-12" />
    </div>
  )
}

export function SafetyPreview() {
  return (
    <div className="w-full max-w-sm space-y-2 text-sm">
      <div className="rounded-md bg-rose-700 px-3 py-1.5 font-semibold text-white">Production, read-only</div>
      <div className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 font-mono"><Kw>DELETE FROM</Kw> users;</div>
      <p className="font-medium text-rose-700 dark:text-rose-400">Blocked: DELETE without WHERE would remove every row.</p>
    </div>
  )
}

export function TeamPreview() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-3 text-sm">
      <div className="text-xs text-muted">\\server\qubase</div>
      <ul className="mt-2 space-y-1">
        <li className="flex justify-between"><span>monthly_sales.sql</span><span className="text-xs text-muted">shared by Sara</span></li>
        <li className="flex justify-between"><span>Production DB</span><span className="text-xs text-muted">no password stored</span></li>
      </ul>
    </div>
  )
}

export function SamplePreview() {
  return (
    <div className="w-full max-w-sm text-sm">
      <div className="mb-2 font-medium">sample-shop.db</div>
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {[['customers', 60], ['products', 10], ['orders', 250]].map(([t, n]) => (
          <div key={t} className="flex justify-between px-3 py-1.5"><span>{t}</span><span className="text-muted tabular-nums">{n} rows</span></div>
        ))}
      </div>
    </div>
  )
}

export function UrlPreview() {
  return (
    <div className="w-full max-w-sm space-y-2 text-sm">
      <div className="truncate rounded-md border border-ember bg-surface px-3 py-2 font-mono text-xs">postgres://app@db.local:5432/shop</div>
      <div className="grid grid-cols-3 gap-2">
        {[['Host', 'db.local'], ['Port', '5432'], ['Database', 'shop']].map(([k, v]) => (
          <div key={k} className="rounded-md border border-line bg-surface px-2.5 py-1.5"><div className="text-xs text-muted">{k}</div>{v}</div>
        ))}
      </div>
    </div>
  )
}
