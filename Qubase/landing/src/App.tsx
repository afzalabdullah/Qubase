import { useEffect, useState, type ReactNode } from 'react'

/** Where the "Download" buttons point. Change this to your installer link. */
const DOWNLOAD_URL = '#download'

/** The maker. Put your real LinkedIn profile address here. */
const AUTHOR = {
  name: 'Abdullah Afzal', role: 'Creator of Qubase',
  linkedin: 'https://www.linkedin.com/in/engr-abdullah-afzal-96b962208/',
  github: 'https://github.com/afzalabdullah',
}

function GitHubIcon({ className = 'size-5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>
}

function LinkedInIcon({ className = 'size-5' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>
}

const DATABASES = [
  'PostgreSQL', 'MySQL', 'SQL Server', 'Oracle', 'SQLite', 'MariaDB', 'MongoDB', 'Redis',
  'Snowflake', 'BigQuery', 'DynamoDB', 'Redshift', 'ClickHouse', 'DuckDB', 'Cassandra',
  'CockroachDB', 'TimescaleDB', 'YugabyteDB', 'TiDB', 'Azure SQL', 'Trino / Presto', 'LibSQL / Turso',
]
const AIS = ['Claude', 'ChatGPT', 'Gemini', 'Groq', 'Kimi', 'OpenRouter', 'Ollama (free, local)', 'Ollama Cloud']

function Logo({ className = 'size-9' }: { className?: string }) {
  return <img src="/icon.png" alt="" className={className} />
}

function Section({ id, kicker, title, lead, children }: { id?: string; kicker: string; title: ReactNode; lead?: string; children?: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
      <div className="mx-auto max-w-3xl text-center">
        <p className="inline-flex rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-bold tracking-[0.18em] text-brand uppercase">{kicker}</p>
        <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-balance sm:text-5xl">{title}</h2>
        {lead && <p className="mt-5 text-lg text-pretty text-soft">{lead}</p>}
      </div>
      {children}
    </section>
  )
}

const O = ({ children }: { children: ReactNode }) => <span className="text-gradient">{children}</span>

/* ---------- Hero editor: types SQL line by line, like the in-app assistant ---------- */
/** One demo per database type: the window cycles through them so it never looks SQL-only. */
type Demo = { db: string; dot: string; file: string; ask: string; reply: string; lines: [string, string][]; cols: string[]; rows: string[][]; meta: string; tree: string; items: string[] }
const DEMOS: Demo[] = [
  {
    db: 'PostgreSQL', dot: 'bg-sky-400', file: 'sales.sql', tree: 'Tables', items: ['customers', 'orders', 'products'],
    ask: 'Total spend per city, biggest first', reply: 'Joined 3 tables using your foreign keys.',
    lines: [['SELECT', ' c.city, SUM(o.total) AS spend'], ['FROM', ' customers c'], ['JOIN', ' orders o ON o.customer_id = c.id'], ['GROUP BY', ' c.city'], ['ORDER BY', ' spend DESC;']],
    cols: ['city', 'spend'], rows: [['Lahore', '48,210'], ['Karachi', '41,875'], ['Islamabad', '29,430']], meta: '3 rows · 38 ms',
  },
  {
    db: 'MongoDB', dot: 'bg-emerald-400', file: 'users.js', tree: 'Collections', items: ['users', 'sessions', 'events'],
    ask: 'Active users per country this month', reply: 'Built an aggregation pipeline for you.',
    lines: [['db.users', '.aggregate(['], ['  { $match', ': { active: true } },'], ['  { $group', ': { _id: "$country", n: { $sum: 1 } } },'], ['  { $sort', ': { n: -1 } }'], ['])', '']],
    cols: ['_id', 'n'], rows: [['PK', '12,480'], ['AE', '6,215'], ['GB', '3,902']], meta: '3 documents · 21 ms',
  },
  {
    db: 'Redis', dot: 'bg-rose-400', file: 'cache.redis', tree: 'Keys', items: ['session:*', 'rate:*', 'leaderboard'],
    ask: 'Show the top 3 on the leaderboard', reply: 'One command, scores included.',
    lines: [['ZREVRANGE', ' leaderboard 0 2 WITHSCORES'], ['TTL', ' session:8f2a'], ['GET', ' rate:api:42']],
    cols: ['member', 'score'], rows: [['ayesha', '9,840'], ['bilal', '9,120'], ['sara', '8,775']], meta: '3 members · 2 ms',
  },
]

function AppWindow() {
  const [d, setD] = useState(0)
  const [step, setStep] = useState(0)
  const demo = DEMOS[d]
  const total = demo.lines.length
  useEffect(() => {
    const t = setInterval(() => setStep((s) => {
      if (s >= total + 8) { setD((x) => (x + 1) % DEMOS.length); return 0 }
      return s + 1
    }), 380)
    return () => clearInterval(t)
  }, [total])
  const pick = (i: number) => { setD(i); setStep(0) }
  const lines = Math.min(step, total)
  const done = step > total + 1

  return (
    <div className="ring-gradient code-surface relative overflow-hidden rounded-[22px] text-left shadow-[0_40px_120px_-40px_#ff8a3d80]">
      {/* title bar */}
      <div className="flex items-center gap-3 border-b border-[#ffffff12] bg-[#1d1f23] px-4 py-2.5">
        <div className="flex gap-1.5"><span className="size-3 rounded-full bg-[#ff5f57]" /><span className="size-3 rounded-full bg-[#febc2e]" /><span className="size-3 rounded-full bg-[#28c840]" /></div>
        <div className="flex min-w-0 gap-1 overflow-hidden text-xs">
          {DEMOS.map((x, i) => (
            <button key={x.db} onClick={() => pick(i)} className={`flex items-center gap-1.5 rounded-md px-3 py-1 whitespace-nowrap transition ${i === d ? 'bg-[#2a2d33] text-[#eceef1]' : 'text-[#8b9099] hover:text-[#eceef1]'}`}>
              <span className={`size-1.5 rounded-full ${x.dot}`} />{x.file}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 sm:flex"><span className="size-1.5 rounded-full bg-emerald-400" />{demo.db}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] lg:grid-cols-[180px_1fr_270px]">
        {/* sidebar */}
        <aside className="hidden border-r border-[#ffffff12] bg-[#1a1c20] p-3 text-xs text-[#aeb3bc] md:block">
          <p className="mb-2 px-2 text-[10px] font-bold tracking-widest text-[#6b7079] uppercase">Connections</p>
          {DEMOS.map((x, i) => (
            <button key={x.db} onClick={() => pick(i)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${i === d ? 'bg-[#ff8a3d1f] text-[#eceef1]' : 'hover:bg-[#ffffff08]'}`}>
              <span className={`size-2 rounded-full ${x.dot}`} />{x.db}
            </button>
          ))}
          <p className="mt-5 mb-2 px-2 text-[10px] font-bold tracking-widest text-[#6b7079] uppercase">{demo.tree}</p>
          {demo.items.map((n) => <div key={n} className="px-2 py-1 font-mono text-[11px]">▸ {n}</div>)}
        </aside>

        {/* editor + results */}
        <div className="flex min-w-0 flex-col">
          <pre className="h-[188px] overflow-hidden p-5 font-mono text-[12.5px] leading-7 text-[#d6d9de] sm:text-[13px]">
            {demo.lines.slice(0, lines).map(([k, rest], i) => (
              <div key={d + '-' + i} className="whitespace-pre"><span className="mr-4 inline-block w-4 text-right text-[#ffffff40]">{i + 1}</span><span className="font-bold text-[#ff8a3d]">{k}</span>{rest}
                {i === lines - 1 && !done && <span className="caret ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-[#ff8a3d]" />}
              </div>
            ))}
            {lines === 0 && <span className="caret inline-block h-4 w-2 bg-[#ff8a3d]" />}
          </pre>
          <div className="border-t border-[#ffffff12]">
            <div className="flex items-center justify-between px-5 py-2 text-[11px] text-[#8b9099]">
              <span className="font-semibold text-[#eceef1]">Results</span><span className={done ? '' : 'opacity-0'}>{demo.meta}</span>
            </div>
            <table className="w-full font-mono text-xs text-[#d6d9de]">
              <thead><tr className="bg-[#ffffff08] text-left text-[#8b9099]">{demo.cols.map((c, i) => <th key={c} className={`px-5 py-1.5 font-semibold ${i ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
              <tbody>
                {demo.rows.map((r, ri) => (
                  <tr key={ri} className={`border-t border-[#ffffff0a] transition-opacity duration-500 ${done ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDelay: `${ri * 90}ms` }}>
                    {r.map((v, i) => <td key={i} className={`px-5 py-1.5 ${i ? 'text-right' : ''}`}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI panel */}
        <div className="hidden flex-col gap-3 border-l border-[#ffffff12] bg-[#1a1c20] p-4 lg:flex">
          <p className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-[#6b7079] uppercase"><span className="size-1.5 rounded-full bg-[#ff8a3d]" />AI assistant</p>
          <div key={'q' + d} className="reveal self-end rounded-2xl rounded-br-sm bg-gradient-to-br from-[#ff8a1f] to-[#ee5a0a] px-3 py-2 text-sm font-semibold text-[#14110e]">{demo.ask}</div>
          <div className="rounded-2xl rounded-bl-sm bg-[#ffffff0d] px-3 py-2 text-sm text-[#aeb3bc]">
            {lines < total ? <>Writing it in your editor<span className="caret">…</span></> : demo.reply}
          </div>
          {done && <div className="reveal rounded-xl border border-[#ffffff12] p-3 text-xs text-[#aeb3bc]"><span className="font-semibold text-emerald-400">✓ Ran</span> · {demo.meta}</div>}
          <div className="mt-auto flex items-center gap-2 rounded-xl border border-[#ffffff12] px-3 py-2 text-xs text-[#6b7079]">Ask anything about your data…<span className="ml-auto text-[#ff8a3d]">↵</span></div>
        </div>
      </div>

      {/* status bar */}
      <div className="flex items-center gap-4 border-t border-[#ffffff12] bg-[#1d1f23] px-4 py-1.5 text-[11px] text-[#6b7079]">
        <span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${demo.dot}`} />{demo.db}</span>
        <span className="hidden sm:inline">Read-only off</span>
        <span className="ml-auto flex gap-1">{DEMOS.map((_, i) => <span key={i} className={`h-1 rounded-full transition-all ${i === d ? 'w-5 bg-[#ff8a3d]' : 'w-1.5 bg-[#ffffff26]'}`} />)}</span>
      </div>
    </div>
  )
}

const ROTATE = ['PostgreSQL', 'MongoDB', 'MySQL', 'Redis', 'SQL Server', 'Snowflake', 'SQLite']
function RotatingWord() {
  const [i, setI] = useState(0)
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % ROTATE.length), 2000); return () => clearInterval(t) }, [])
  return <span key={i} className="reveal inline-block text-gradient">{ROTATE[i]}</span>
}

/* ---------- Small product mock-ups ---------- */
function QueryBuilderMock() {
  const Card = ({ name, cols, className }: { name: string; cols: [string, boolean?][]; className: string }) => (
    <div className={`absolute w-40 overflow-hidden rounded-lg border border-brand/50 bg-ink-2 text-xs ${className}`}>
      <div className="bg-brand-2 px-3 py-1.5 font-bold text-[#fff]">{name}</div>
      {cols.map(([c, on]) => <div key={c} className={`px-3 py-1 ${on ? 'bg-brand/15 text-white' : 'text-soft'}`}>{on ? '☑ ' : ''}{c}</div>)}
    </div>
  )
  return (
    <div className="relative mx-auto h-[240px] w-[400px] max-sm:-my-6 max-sm:origin-center max-sm:scale-[0.72]">
      <svg className="absolute inset-0 size-full" viewBox="0 0 400 240"><g fill="none" stroke="#ff8a3d" strokeWidth="2"><path d="M160 49 C200 49 200 65 240 65" /><circle cx="160" cy="49" r="3" fill="#ff8a3d" /><circle cx="240" cy="65" r="3" fill="#ff8a3d" /><path d="M320 112 C320 193 300 193 280 193" strokeDasharray="6 5" /><circle cx="280" cy="193" r="3" fill="#ff8a3d" /></g></svg>
      <Card name="customers" cols={[['id'], ['city', true], ['name']]} className="top-[8px] left-0" />
      <Card name="orders" cols={[['id'], ['customer_id'], ['ordered_at']]} className="top-0 left-[240px]" />
      <Card name="products" cols={[['id'], ['price', true], ['category']]} className="top-[128px] left-[120px]" />
    </div>
  )
}

function ScheduleMock() {
  const F = ({ k, v, hl }: { k: string; v: string; hl?: boolean }) => (
    <div className={`rounded-lg border bg-ink-2 px-3 py-2 ${hl ? 'border-brand/60' : 'border-white/10'}`}>
      <div className="text-[10px] font-bold tracking-widest text-mute uppercase">{k}</div><div className="font-semibold">{v}</div>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <F k="Connection" v="Production DB" /><F k="Database" v="sales ▾" hl />
      <F k="Repeat" v="Weekdays · 08:00" /><F k="Save as" v="Excel (.xlsx)" />
      <div className="col-span-2 rounded-lg border border-white/10 bg-ink-3 px-3 py-2 font-mono text-xs"><span className="text-brand">SELECT</span> region, <span className="text-brand">SUM</span>(amount) <span className="text-brand">FROM</span> ord<span className="ml-1 rounded border border-brand/60 px-1">orders</span></div>
    </div>
  )
}

function ErMock() {
  return (
    <svg viewBox="0 0 330 210" className="h-56 w-full sm:h-60">
      <g fill="none" stroke="#ff8a3d" strokeWidth="2"><path d="M120 50 H170 V120 H210" /><path d="M330 130 H360 V40 H300" /></g>
      {[{ x: 10, y: 20, n: 'users', c: ['id', 'email'] }, { x: 210, y: 95, n: 'orders', c: ['id', 'user_id', 'total'] }, { x: 200, y: 10, n: 'invoices', c: ['id', 'order_id'] }].map((t) => (
        <g key={t.n} transform={`translate(${t.x} ${t.y})`}>
          <rect width="110" height={28 + t.c.length * 20} rx="8" fill="var(--ink-2)" stroke="#ff8a3d88" />
          <rect width="110" height="24" rx="8" fill="#ee5a0a" /><text x="10" y="17" fill="#ffffff" fontSize="12" fontWeight="700">{t.n}</text>
          {t.c.map((c, i) => <text key={c} x="10" y={42 + i * 20} fill="var(--soft)" fontSize="11">{c}</text>)}
        </g>
      ))}
    </svg>
  )
}

/* ---------- Page ---------- */
/* ---------- AI section ---------- */
const AI_POINTS: [string, string, string][] = [
  ['👁️', 'Knows your context', 'Your query, cursor line, selection, the last error and your schema.'],
  ['✍️', 'Writes into the editor', 'Watch the fix appear line by line, or insert it at your cursor.'],
  ['▶️', 'Runs it for you', 'One click to run, with the results kept next to the answer.'],
  ['🗂️', 'Every chat is saved', 'Search old chats and see exactly what each query returned.'],
]

function AiChatMock() {
  return (
    <div className="ring-gradient code-surface relative overflow-hidden rounded-3xl text-left shadow-[0_40px_120px_-40px_#ff8a3d80]">
      <div className="flex items-center gap-2 border-b border-[#ffffff12] bg-[#1d1f23] px-4 py-3 text-xs">
        <span className="size-2 rounded-full bg-[#ff8a3d]" /><span className="font-bold text-[#eceef1]">AI assistant</span>
        <span className="ml-auto text-[#6b7079]">Chat history</span>
      </div>
      <div className="space-y-4 p-5 text-sm">
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {['📄 orders.sql', '↳ line 3', '⚠ last error', '▦ schema'].map((c) => <span key={c} className="rounded-md border border-[#ffffff14] bg-[#ffffff08] px-2 py-0.5 text-[#aeb3bc]">{c}</span>)}
        </div>
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-br from-[#ff8a1f] to-[#ee5a0a] px-4 py-2.5 font-semibold text-[#14110e]">Why does line 3 fail? Fix it.</div>
        <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-[#ffffff0d] px-4 py-3 text-[#c9ccd2]">
          <p><span className="font-mono text-[#ff8a3d]">customer</span> doesn’t exist. Your schema calls it <span className="font-mono text-[#ff8a3d]">customers</span>, and the join needs <span className="font-mono">customer_id</span>.</p>
          <div className="mt-3 overflow-hidden rounded-xl border border-[#ffffff12] font-mono text-xs">
            <div className="bg-rose-500/10 px-3 py-1.5 text-rose-300">− JOIN customer c ON c.id = o.id</div>
            <div className="bg-emerald-500/10 px-3 py-1.5 text-emerald-300">+ JOIN customers c ON c.id = o.customer_id</div>
          </div>
          <div className="mt-3 flex gap-2 text-xs font-semibold">
            <span className="rounded-lg bg-[#ff8a3d] px-3 py-1 text-[#14110e]">Replace query</span>
            <span className="rounded-lg border border-[#ffffff1f] px-3 py-1 text-[#eceef1]">Insert</span>
            <span className="rounded-lg border border-[#ffffff1f] px-3 py-1 text-[#eceef1]">▶ Run</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">✓ Ran · 250 rows in 41 ms</div>
      </div>
      <div className="flex items-center gap-2 border-t border-[#ffffff12] px-5 py-3 text-xs text-[#6b7079]">
        Ask about your data…<span className="ml-auto rounded-md bg-[#ff8a3d] px-2 py-0.5 font-bold text-[#14110e]">↵</span>
      </div>
    </div>
  )
}

/* ---------- Small mock-ups for every feature card ---------- */
const K = ({ children }: { children: ReactNode }) => <span className="font-bold text-brand">{children}</span>

function EditorMock() {
  return (
    <div className="font-mono text-xs leading-6">
      <div><K>SELECT</K> o.id, o.<span className="rounded bg-brand/20 px-0.5">to</span><span className="caret inline-block h-3 w-1.5 bg-brand" /></div>
      <div className="ml-16 w-40 overflow-hidden rounded-md border border-white/10 bg-ink-2 shadow-lg">
        {[['total', 'numeric'], ['total_tax', 'numeric'], ['to_ship', 'bool']].map(([c, t], i) => (
          <div key={c} className={`flex justify-between px-2 ${i === 0 ? 'bg-brand/20 text-white' : 'text-soft'}`}><span>{c}</span><span className="text-mute">{t}</span></div>
        ))}
      </div>
    </div>
  )
}

function CompareMock() {
  const rows: [string, string, string][] = [['users', '=', ''], ['orders', '~', 'text-amber-500'], ['invoices', '+', 'text-emerald-400'], ['legacy_log', '−', 'text-rose-400']]
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <div className="font-bold text-mute">staging</div><div /><div className="font-bold text-mute">production</div>
      {rows.map(([t, s, c]) => (
        <div key={t} className="contents">
          <div className={`rounded bg-ink-2 px-2 py-1 ${s === '+' ? 'opacity-30' : ''}`}>{t}</div>
          <div className={`font-mono font-bold ${c || 'text-mute'}`}>{s}</div>
          <div className={`rounded bg-ink-2 px-2 py-1 ${s === '−' ? 'opacity-30' : ''}`}>{t}</div>
        </div>
      ))}
    </div>
  )
}

function ChartMock() {
  const bars = [40, 65, 52, 80, 70, 95, 88]
  return (
    <div className="flex h-24 items-end gap-2">
      {bars.map((h, i) => <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-brand-2 to-brand" style={{ height: `${h}%`, opacity: 0.5 + i * 0.07 }} />)}
    </div>
  )
}

function ImportMock() {
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-bold">
      {[['XLSX', 'bg-emerald-600'], ['CSV', 'bg-sky-600'], ['JSON', 'bg-violet-600']].map(([l, c]) => (
        <div key={l} className={`grid h-14 w-11 place-items-end rounded-md ${c} p-1 text-[10px] text-[#fff] shadow`}>{l}</div>
      ))}
      <span className="text-xl text-brand">⇄</span>
      <div className="grid h-14 w-14 place-items-center rounded-full bg-ink-2 ring-1 ring-brand/50"><img src="/icon.png" alt="" className="size-8" /></div>
    </div>
  )
}

function SafetyMock() {
  return (
    <div className="space-y-2 text-xs">
      <div className="rounded-md bg-rose-600 px-2 py-1 font-bold text-[#fff]">● PRODUCTION · read-only</div>
      <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 font-mono"><K>DELETE FROM</K> users<span className="caret">;</span></div>
      <div className="font-semibold text-rose-500">Blocked: DELETE without WHERE</div>
    </div>
  )
}

function TeamMock() {
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex -space-x-2">
        {['JD', 'SK'].map((n, i) => <div key={n} className={`grid size-9 place-items-center rounded-full font-bold text-ink ring-2 ring-ink ${['bg-brand', 'bg-sky-400', 'bg-emerald-400'][i]}`}>{n}</div>)}
      </div>
      <div className="min-w-0 flex-1 truncate rounded-md bg-ink-2 px-2 py-1.5 [&>div]:truncate">
        <div className="text-mute">\\server\qubase</div>
        <div>📄 monthly_sales.sql</div><div>🔌 Production DB</div>
      </div>
    </div>
  )
}

function SampleMock() {
  return (
    <div className="space-y-1 text-xs">
      <div className="mb-2 font-bold">🛒 sample-shop.db</div>
      {[['customers', 60], ['products', 10], ['orders', 250]].map(([t, n]) => (
        <div key={t} className="flex justify-between rounded bg-ink-2 px-2 py-1"><span>▦ {t}</span><span className="text-mute">{n} rows</span></div>
      ))}
    </div>
  )
}

function UrlMock() {
  return (
    <div className="space-y-2 text-xs">
      <div className="truncate rounded-md border border-brand/50 bg-ink-2 px-2 py-1.5 font-mono">postgres://app@db.local:5432/shop</div>
      <div className="text-center text-brand">↓ fills the form</div>
      <div className="grid grid-cols-3 gap-1.5">
        {[['Host', 'db.local'], ['Port', '5432'], ['DB', 'shop']].map(([k, v]) => (
          <div key={k} className="rounded bg-ink-2 px-2 py-1"><div className="text-[9px] text-mute uppercase">{k}</div>{v}</div>
        ))}
      </div>
    </div>
  )
}

const FEATURES: { icon: string; title: string; text: string; m: ReactNode }[] = [
  { icon: '⌨️', title: 'A smart query editor', text: 'Autocomplete for tables, collections and fields, one-click formatting, snippets, parameters and run-current-statement.', m: <EditorMock /> },
  { icon: '⚖️', title: 'Schema and data compare', text: 'Spot what changed between two databases and get the script to sync them.', m: <CompareMock /> },
  { icon: '📊', title: 'Charts and dashboards', text: 'Turn any result into a chart and pin it to a dashboard.', m: <ChartMock /> },
  { icon: '📥', title: 'Import and export', text: 'Excel, CSV and JSON in and out, with a preview before anything is written.', m: <ImportMock /> },
  { icon: '🛡️', title: 'Production safety', text: 'Read-only connections, a red production banner, and a block on UPDATE or DELETE without WHERE.', m: <SafetyMock /> },
  { icon: '👥', title: 'Team folder', text: 'Share saved queries and connections (without passwords) through a shared folder.', m: <TeamMock /> },
  { icon: '🧪', title: 'Sample database', text: 'Try everything in seconds on a ready-made shop database, no server needed.', m: <SampleMock /> },
  { icon: '🔗', title: 'Paste a connection URL', text: 'Paste postgres://… and the form fills itself. Errors come with a plain-English fix.', m: <UrlMock /> },
]

type Tile = { icon: string; title: string; text: string; m: ReactNode; span?: string; big?: boolean; isNew?: boolean }
const feature = (title: string) => FEATURES.find((f) => f.title === title)!
const BENTO: Tile[] = [
  { icon: '🧩', title: 'Visual query builder', text: 'Drag tables onto a canvas. Joins come from foreign keys. Add filters, GROUP BY, HAVING and paging, and watch the query write itself.', m: <QueryBuilderMock />, span: 'sm:col-span-2 lg:row-span-2', big: true, isNew: true },
  { icon: '⏰', title: 'Scheduled reports', text: 'Every weekday at 8:00, saved as Excel, CSV, JSON or HTML, with a notification when it is done.', m: <ScheduleMock />, span: 'sm:col-span-2', isNew: true },
  { ...feature('A smart query editor') },
  { ...feature('Schema and data compare') },
  { ...feature('Charts and dashboards'), span: 'sm:col-span-2' },
  { icon: '🗺️', title: 'ER diagrams', text: 'See how your tables connect, and design new ones without writing CREATE TABLE.', m: <ErMock />, span: 'sm:col-span-2' },
  { ...feature('Production safety') },
  { ...feature('Import and export') },
  { ...feature('Team folder'), span: 'sm:col-span-2' },
  { ...feature('Sample database'), span: 'sm:col-span-2' },
  { ...feature('Paste a connection URL'), span: 'sm:col-span-2' },
]

const FAQ: [string, string][] = [
  ['Which databases does Qubase support?', `${DATABASES.length + 1} in total, including ${DATABASES.slice(0, 8).join(', ')} and more.`],
  ['Do I need to pay for the AI?', 'No. Run Ollama on your own machine for free, use Ollama Cloud’s free plan, or bring a key for Claude, ChatGPT, Gemini, Groq, Kimi or OpenRouter.'],
  ['Does the AI see my data?', 'It gets table and column names and the query you are working on. Your rows are only sent if you ask it about a result.'],
  ['Where are my passwords stored?', 'On your computer, encrypted with the operating system’s secure storage. Nothing goes to a Qubase server.'],
  ['Which operating systems are supported?', 'Windows today. macOS and Linux builds are on the way.'],
]

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme as 'light' | 'dark') || 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* private mode */ }
  }, [theme])
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')] as const
}

function ThemeToggle({ theme, toggle }: { theme: 'light' | 'dark'; toggle: () => void }) {
  return (
    <button onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Switch theme"
      className="grid size-9 place-items-center rounded-lg border border-white/10 text-soft transition hover:border-brand/50 hover:text-brand">
      {theme === 'dark'
        ? <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </button>
  )
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [open, setOpen] = useState<number | null>(0)
  const [menu, setMenu] = useState(false)
  const nav = [['Features', '#features'], ['AI', '#ai'], ['Databases', '#databases'], ['FAQ', '#faq'], ['About', '#maker']]

  return (
    <div className="relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[radial-gradient(900px_600px_at_85%_-10%,var(--glow-a),transparent_60%),radial-gradient(700px_500px_at_-10%_40%,var(--glow-b),transparent_60%)]" />

      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-ink/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href="#" className="flex items-center gap-2.5 text-lg font-bold"><Logo className="size-8" />Qubase</a>
          <nav className="hidden items-center gap-8 text-sm text-soft md:flex">
            {nav.map(([l, h]) => <a key={h} href={h} className="hover:text-white">{l}</a>)}
          </nav>
          <div className="flex items-center gap-2">
            <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub" className="hidden size-9 place-items-center rounded-lg border border-white/10 text-soft transition hover:border-brand/50 hover:text-brand sm:grid"><GitHubIcon className="size-4" /></a>
            <ThemeToggle theme={theme} toggle={toggleTheme} />
            <a href={DOWNLOAD_URL} className="rounded-lg bg-gradient-to-br from-brand to-brand-2 px-4 py-2 text-sm font-bold text-ink hover:brightness-110">Download</a>
            <button aria-label="Menu" className="rounded-lg p-2 text-soft md:hidden" onClick={() => setMenu(!menu)}>☰</button>
          </div>
        </div>
        {menu && <nav className="flex flex-col gap-1 border-t border-white/5 px-4 py-3 md:hidden">{nav.map(([l, h]) => <a key={h} href={h} onClick={() => setMenu(false)} className="rounded px-2 py-2 text-soft hover:bg-white/5">{l}</a>)}</nav>}
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-7xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
        <div className="pointer-events-none absolute top-24 left-1/2 -z-0 size-[560px] -translate-x-1/2 rounded-full bg-brand/20 blur-[140px]" />
        <div className="reveal relative mx-auto max-w-4xl text-center">
          <a href="#ai" className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-ink-2/70 py-1 pr-3 pl-1 text-xs font-semibold backdrop-blur transition hover:border-brand/50">
            <span className="rounded-full bg-gradient-to-r from-brand to-brand-2 px-2 py-0.5 text-[#fff]">New</span>
            <span className="text-soft">AI that writes queries right in your editor</span>
            <span className="text-brand transition group-hover:translate-x-0.5">→</span>
          </a>
          <h1 className="mt-7 text-5xl leading-[1.02] font-black tracking-tighter text-balance sm:text-7xl lg:text-8xl">
            One app for<br />every database.
          </h1>
          <p className="mt-5 text-2xl font-bold tracking-tight text-soft sm:text-3xl">Query <RotatingWord /><br className="sm:hidden" /> without switching tools.</p>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-soft">
            Qubase is a fast desktop studio for 23 databases, with a visual query builder, ER diagrams, scheduled reports and an AI assistant that writes queries in your editor while you watch.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href={DOWNLOAD_URL} className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand to-brand-2 px-7 py-3.5 font-bold text-[#14110e] shadow-[0_10px_40px_-8px_#ff8a3d99] transition hover:-translate-y-0.5 hover:brightness-110">
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor"><path d="M3 5.5 10.5 4.5v7H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" /></svg>
              Download for Windows
            </a>
            <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-ink-2/60 px-7 py-3.5 font-semibold backdrop-blur transition hover:border-brand/50">
              <GitHubIcon className="size-4" />View on GitHub
            </a>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-mute">
            {['Bring your own AI', 'Passwords encrypted locally', 'No account needed'].map((x) => (
              <span key={x} className="flex items-center gap-1.5"><svg viewBox="0 0 20 20" className="size-4 text-brand" fill="currentColor"><path d="M8 13.6 4.4 10l-1.4 1.4L8 16.4l9-9L15.6 6z" /></svg>{x}</span>
            ))}
          </div>
        </div>

        <div className="reveal relative mx-auto mt-16 max-w-6xl [animation-delay:.2s]">
          <div className="pointer-events-none absolute -inset-x-10 -bottom-10 top-1/3 -z-0 rounded-[40px] bg-gradient-to-b from-brand/0 via-brand/15 to-brand/0 blur-3xl" />
          <div className="relative"><AppWindow /></div>
        </div>
      </section>

      {/* Database strip */}
      <div className="relative overflow-hidden border-y border-white/5 bg-ink-3/60 py-6 [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
        <div className="marquee flex w-max gap-10 text-sm font-semibold whitespace-nowrap text-mute">
          {[...DATABASES, ...DATABASES].map((d, i) => <span key={i} className="flex items-center gap-10">{d}<span className="text-brand/40">◆</span></span>)}
        </div>
      </div>

      {/* AI */}
      <section id="ai" className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="inline-flex rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-bold tracking-[0.18em] text-brand uppercase">AI assistant</p>
            <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">An AI that <O>sees your editor</O> and writes with you</h2>
            <p className="mt-5 text-lg text-pretty text-soft">No copy and paste into a chat window. It already knows what you are working on, and it writes the answer straight into your editor, line by line.</p>
            <ul className="mt-8 space-y-4">
              {AI_POINTS.map(([icon, title, text]) => (
                <li key={title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-lg ring-1 ring-brand/25">{icon}</span>
                  <div><p className="font-bold">{title}</p><p className="text-sm text-soft">{text}</p></div>
                </li>
              ))}
            </ul>
          </div>
          <AiChatMock />
        </div>

        <div className="mt-16 rounded-3xl border border-white/10 bg-ink-2/50 p-6 sm:p-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="text-center md:text-left">
              <p className="font-bold">Bring your own AI</p>
              <p className="text-sm text-soft">Use the provider you already pay for, or a free model. Switch any time in Settings.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 md:justify-end">
              {AIS.map((a) => <span key={a} className="rounded-full border border-white/10 bg-ink px-3.5 py-1.5 text-sm font-semibold transition hover:border-brand/50">{a}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* Builder + Schedules + ER */}
      <div id="features" />
      <Section kicker="Build without typing" title={<>Everything you need, <O>one window</O></>}>
        <div className="mt-14 grid grid-flow-dense auto-rows-[minmax(0,auto)] gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {BENTO.map((f) => (
            <article key={f.title} className={`glow-card group flex flex-col overflow-hidden rounded-3xl ${f.span ?? ''}`}>
              <div className={`relative m-2 mb-0 flex flex-1 flex-col justify-center overflow-hidden rounded-[20px] border border-white/5 bg-ink-3 p-5 ${f.big ? 'min-h-72' : 'min-h-40'}`}>
                <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-brand/0 blur-3xl transition duration-500 group-hover:bg-brand/25" />
                <div className="relative">{f.m}</div>
              </div>
              <div className="p-5 pt-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-lg bg-brand/10 text-base ring-1 ring-brand/25">{f.icon}</span>
                  <h3 className={`font-bold tracking-tight ${f.big ? 'text-xl' : 'text-base'}`}>{f.title}</h3>
                  {f.isNew && <span className="ml-auto rounded-full bg-gradient-to-r from-brand to-brand-2 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[#fff] uppercase">New</span>}
                </div>
                <p className={`mt-2 text-soft ${f.big ? '' : 'text-sm'}`}>{f.text}</p>
              </div>
            </article>
          ))}
        </div>
      </Section>

      {/* Databases */}
      <Section id="databases" kicker="Databases" title={<>Works with <O>the databases you already use</O></>}>
        <div className="mt-10 flex flex-wrap gap-3">
          {DATABASES.map((d) => <span key={d} className="rounded-xl border border-white/10 bg-ink-2 px-4 py-2 font-semibold">{d}</span>)}
          <span className="rounded-xl border border-brand/50 bg-brand/10 px-4 py-2 font-semibold text-brand">and more</span>
        </div>
      </Section>

      {/* Privacy */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-8 rounded-3xl border border-brand/30 bg-gradient-to-br from-brand/10 to-transparent p-8 sm:p-12 md:grid-cols-[1fr_1.2fr]">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Your data <O>stays yours</O></h2>
          <ul className="space-y-4 text-soft">
            <li>🔒 Passwords and API keys are encrypted with your operating system’s secure storage.</li>
            <li>💻 Connections, queries and settings live on your computer, not on our servers.</li>
            <li>🤖 The AI gets table and column names, not your rows.</li>
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <Section id="faq" kicker="FAQ" title="Questions">
        <div className="mt-10 divide-y divide-white/10 rounded-2xl border border-white/10 bg-ink-2/60">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-semibold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}<span className={`text-brand transition ${open === i ? 'rotate-45' : ''}`}>+</span>
              </button>
              {open === i && <p className="px-6 pb-5 text-soft">{a}</p>}
            </div>
          ))}
        </div>
      </Section>

      {/* Maker */}
      <section id="maker" className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
        <div className="ring-gradient glow-card grid grid-cols-[minmax(0,1fr)] gap-8 overflow-hidden rounded-3xl p-6 sm:p-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-brand uppercase">Built by</p>
            <h3 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{AUTHOR.name}</h3>
            <p className="mt-1 font-semibold text-mute">{AUTHOR.role}</p>
            <blockquote className="mt-6 border-l-2 border-brand pl-4 text-lg text-pretty text-soft">
              “I built Qubase because I was tired of juggling a different app for every database. Got an idea or found a bug? I would love to hear from you.”
            </blockquote>
          </div>
          <div className="grid gap-3">
            <a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-ink-2 p-4 transition hover:border-[#0a66c2] hover:shadow-[0_10px_40px_-15px_#0a66c2]">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#0a66c2] text-[#fff]"><LinkedInIcon className="size-6" /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">LinkedIn</span><span className="block truncate text-sm text-mute">Connect and follow updates</span></span>
              <span className="text-mute transition group-hover:translate-x-1 group-hover:text-fg">→</span>
            </a>
            <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-ink-2 p-4 transition hover:border-brand/60 hover:shadow-[0_10px_40px_-15px_#ff8a3d]">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-fg text-ink"><GitHubIcon className="size-6" /></span>
              <span className="min-w-0 flex-1"><span className="block font-bold">GitHub</span><span className="block truncate text-sm text-mute">{AUTHOR.github.replace('https://', '')}</span></span>
              <span className="text-mute transition group-hover:translate-x-1 group-hover:text-fg">→</span>
            </a>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="download" className="mx-auto max-w-6xl px-4 pb-24 text-center sm:px-6">
        <Logo className="mx-auto size-20 drop-shadow-[0_20px_40px_#ff8a3d55]" />
        <h2 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-5xl">Try Qubase today</h2>
        <p className="mt-4 text-lg text-soft">Open the sample database and start querying in under a minute.</p>
        <a href={DOWNLOAD_URL} className="mt-8 inline-block rounded-xl bg-gradient-to-br from-brand to-brand-2 px-8 py-4 font-bold text-ink shadow-lg shadow-brand/25 hover:brightness-110">Download for Windows</a>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-sm text-mute">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2"><Logo className="size-5" />Qubase · © {new Date().getFullYear()} {AUTHOR.name}</div>
          <div className="flex items-center gap-5"><a href={AUTHOR.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-white"><LinkedInIcon className="size-4" />LinkedIn</a><a href={AUTHOR.github} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-white"><GitHubIcon className="size-4" />GitHub</a></div>
        </div>
      </footer>
    </div>
  )
}
