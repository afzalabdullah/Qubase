import { useEffect, useRef, useState } from 'react'
import { IconCopy, IconHistory, IconPlay, IconPlus, IconSpark, IconStop, IconTrash, IconX } from './Icons'
import { errMsg } from '../util'
import { Markdown } from '../markdown'
import { aiProvider, type AiConfigView } from '../../shared/aiProviders'
import { clearChats, deleteChat, getChat, listChats, saveChat, type ChatMsg, type SavedChat } from '../aiChats'
import { cellText } from '../util'

/** What happened when SQL from an answer was run */
export interface RunOutcome { rows?: number; ms?: number; error?: string; preview?: { columns: string[]; rows: unknown[][] } }

/** What the panel can see and do in the query editor */
export interface EditorBridge {
  context(): { text: string; selection: string; cursorLine: number; lineCount: number }
  /** Starts writing into the editor: at the cursor (replacing a selection) or over the whole query */
  live(where: 'cursor' | 'replace'): { update(code: string): void; done(): void }
  insert(code: string): void
  replace(code: string): void
  run(code: string): Promise<RunOutcome | undefined>
}

interface Props {
  engine: string
  /** Builds the schema text (tables and columns) on demand */
  getSchema: () => Promise<string>
  lastError: string
  editor: EditorBridge
  /** Keeps the open conversation when the panel is closed and opened again */
  chatKey: string
  /** Connection name, saved with the chat */
  connection?: string
  onClose: () => void
}

type Msg = ChatMsg & { streaming?: boolean }
type LiveMode = 'off' | 'cursor' | 'replace'

/** Which saved chat each query tab has open */
const openChat = new Map<string, string>()
const LIVE_KEY = 'aiLiveWrite'
const LINE_MS = 70

/** The SQL being written: text of the first ``` block, even if it is not closed yet */
function firstCode(text: string): { code: string; closed: boolean } | null {
  const open = /```[a-zA-Z]*[^\n]*\n/.exec(text)
  if (!open) return null
  const rest = text.slice(open.index + open[0].length)
  const end = rest.indexOf('```')
  return end < 0 ? { code: rest, closed: false } : { code: rest.slice(0, end).replace(/\n$/, ''), closed: true }
}

/** Answer split into prose and code blocks */
function segments(text: string): { kind: 'text' | 'code'; body: string; open?: boolean }[] {
  const out: { kind: 'text' | 'code'; body: string; open?: boolean }[] = []
  const re = /```[a-zA-Z]*[^\n]*\n([\s\S]*?)(```|$)/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: 'text', body: text.slice(last, m.index) })
    out.push({ kind: 'code', body: m[1].replace(/\n$/, ''), open: m[2] !== '```' })
    last = m.index + m[0].length
    if (!m[0]) break
  }
  if (last < text.length) out.push({ kind: 'text', body: text.slice(last) })
  return out.filter((s) => s.kind === 'code' || s.body.trim())
}

const STARTERS: [string, string][] = [
  ['Explain this query', 'Explain what this query does, step by step.'],
  ['Fix the error', 'Fix the query so the last error goes away.'],
  ['Make it faster', 'Make this query faster and tell me which indexes would help.'],
  ['Add comments', 'Add short comments to this query explaining each part.']
]

/** Chat with the AI beside the editor. It sees the query, the selection and the last error, and types SQL into the editor line by line. */
export function AiPanel({ engine, getSchema, lastError, editor, chatKey, connection, onClose }: Props) {
  const [chatId, setChatId] = useState(() => openChat.get(chatKey) ?? crypto.randomUUID())
  const created = useRef(getChat(chatId)?.created ?? Date.now())
  const [msgs, setMsgsState] = useState<Msg[]>(() => getChat(chatId)?.messages ?? [])
  const msgsRef = useRef(msgs)
  const setMsgs = (fn: (m: Msg[]) => Msg[]) => setMsgsState((cur) => { const n = fn(cur); msgsRef.current = n; return n })
  useEffect(() => { openChat.set(chatKey, chatId) }, [chatKey, chatId])
  const [view, setView] = useState<'chat' | 'history'>('chat')
  const [histQ, setHistQ] = useState('')
  const [history, setHistory] = useState<SavedChat[]>([])
  /** Store the conversation (without the half-written answer) */
  const persist = (id = chatId) => {
    const messages = msgsRef.current.filter((m) => !m.streaming).map(({ streaming: _s, ...m }) => m)
    saveChat({ id, created: created.current, connection, engine, model: cfg ? cfg.providers[cfg.provider]?.model : undefined, messages })
  }
  const [input, setInput] = useState('')
  const [busyId, setBusyId] = useState('')
  const [live, setLive] = useState<LiveMode>(() => { try { return (localStorage.getItem(LIVE_KEY) as LiveMode) || 'replace' } catch { return 'replace' } })
  const [useCtx, setUseCtx] = useState({ query: true, error: true })
  const [ctx, setCtx] = useState(() => editor.context())
  const [cfg, setCfg] = useState<AiConfigView | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { window.db.aiGetConfig().then(setCfg).catch(() => {}) }, [])
  useEffect(() => { try { localStorage.setItem(LIVE_KEY, live) } catch { /* ignore */ } }, [live])
  // Keep the context chips current while the panel is open
  useEffect(() => { const t = setInterval(() => setCtx(editor.context()), 700); return () => clearInterval(t) }, [editor])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [msgs])
  useEffect(() => () => { if (busyId) window.db.aiStop(busyId) }, [busyId])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busyId) return
    const id = crypto.randomUUID()
    const history: Msg[] = [...msgs.filter((m) => !m.error), { role: 'user', content: q, at: Date.now() }]
    setMsgs(() => [...history, { role: 'assistant', content: '', streaming: true, at: Date.now() }])
    setInput(''); setBusyId(id)

    // Live typing: SQL is revealed into the editor one line at a time, a little behind the stream
    let answer = ''
    let writer: ReturnType<EditorBridge['live']> | null = null
    let shown = 0
    let target = ''
    let ended = false
    const tick = setInterval(() => {
      if (!writer) return
      const lines = target.split('\n')
      const full = ended ? lines.length : lines.length - 1 // the last line is still being written
      if (shown < full) { shown++; writer.update(lines.slice(0, shown).join('\n')) }
    }, LINE_MS)
    const finishWriter = () => new Promise<void>((resolve) => {
      ended = true
      const wait = setInterval(() => {
        if (!writer || shown >= target.split('\n').length) { clearInterval(wait); writer?.update(target); writer?.done(); resolve() }
      }, LINE_MS)
    })

    const off = window.db.onAiChunk((cid, t) => {
      if (cid !== id) return
      answer += t
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, content: answer } : x)))
      if (live === 'off') return
      const code = firstCode(answer)
      if (!code) return
      if (!writer) writer = editor.live(live)
      target = code.code.replace(/\n$/, '')
      if (code.closed) ended = true
    })
    try {
      const c = editor.context()
      await window.db.aiChat(id, {
        engine,
        schema: await getSchema(),
        editor: useCtx.query ? { text: c.text, selection: c.selection, cursorLine: c.cursorLine, lineCount: c.lineCount } : { text: '' },
        lastError: useCtx.error ? lastError || undefined : undefined,
        messages: history.map(({ role, content }) => ({ role, content }))
      })
      if (writer) await finishWriter()
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, streaming: false } : x)))
    } catch (e) {
      setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, streaming: false, error: errMsg(e) } : x)))
    } finally {
      clearInterval(tick); off(); setBusyId('')
      persist()
      inputRef.current?.focus()
    }
  }

  /** Run SQL from an answer and keep the outcome (rows, time, first rows or the error) in the chat */
  const runCode = async (msgIndex: number, code: string) => {
    const r = await editor.run(code)
    if (!r) return
    setMsgs((m) => m.map((x, i) => (i === msgIndex ? { ...x, ran: { ...r, at: Date.now() } } : x)))
    persist()
  }

  const stop = () => { if (busyId) window.db.aiStop(busyId) }
  const openChatById = (c: SavedChat | null) => {
    stop()
    const id = c?.id ?? crypto.randomUUID()
    created.current = c?.created ?? Date.now()
    setChatId(id)
    setMsgs(() => c?.messages ?? [])
    setView('chat')
  }
  const newChat = () => openChatById(null)
  const showHistory = () => { setHistory(listChats()); setView('history') }
  const shownHistory = history.filter((c) => !histQ.trim() || `${c.title} ${c.connection ?? ''} ${c.messages.map((m) => m.content).join(' ')}`.toLowerCase().includes(histQ.trim().toLowerCase()))
  const dayLabel = (t: number) => {
    const d = new Date(t), today = new Date()
    const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  const prov = cfg ? aiProvider(cfg.provider) : null
  const model = cfg ? cfg.providers[cfg.provider]?.model : ''

  return (
    <aside className="ai-panel ai-chat">
      <div className="json-head">
        <IconSpark width={14} height={14} /><strong>AI assistant</strong>
        {prov && <span className="ai-model muted small-text" title={`${prov.label} · change in Settings → AI assistant`}>{model || prov.label}</span>}
        <div className="spacer" />
        <button className={`icon-btn ${view === 'history' ? 'on' : ''}`} onClick={() => (view === 'history' ? setView('chat') : showHistory())} title="Chat history"><IconHistory width={14} height={14} /></button>
        <button className="icon-btn" onClick={newChat} title="New chat" disabled={!msgs.length && view === 'chat'}><IconPlus width={14} height={14} /></button>
        <button className="icon-btn" onClick={onClose} title="Close"><IconX /></button>
      </div>

      {view === 'history' && (
        <div className="ai-history">
          <div className="ai-history-head">
            <input autoFocus value={histQ} onChange={(e) => setHistQ(e.target.value)} placeholder={`Search ${history.length} chats…`} />
            <button className="btn btn-sm ghost" disabled={!history.length} onClick={() => { if (window.confirm(`Delete all ${history.length} saved chats? This cannot be undone.`)) { clearChats(); setHistory([]) } }}>Clear all</button>
          </div>
          {!shownHistory.length && <p className="muted small-text ai-pad">{history.length ? 'No chat matches.' : 'No saved chats yet. Every conversation is saved here automatically.'}</p>}
          {shownHistory.map((c, i) => {
            const label = dayLabel(c.updated)
            const runs = c.messages.filter((m) => m.ran).length
            return [
              (i === 0 || dayLabel(shownHistory[i - 1].updated) !== label) && <div key={'d' + c.id} className="ai-history-day">{label}</div>,
              <div key={c.id} className={`ai-history-item ${c.id === chatId ? 'on' : ''}`} onClick={() => openChatById(c)}>
                <div className="grow">
                  <div className="ai-history-title">{c.title}</div>
                  <div className="muted small-text">
                    {[c.connection, c.model, `${c.messages.filter((m) => m.role === 'user').length} questions`, runs ? `${runs} run${runs > 1 ? 's' : ''}` : '', new Date(c.updated).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <button className="icon-btn" title="Delete this chat" onClick={(e) => { e.stopPropagation(); deleteChat(c.id); setHistory(listChats()); if (c.id === chatId) newChat() }}><IconTrash width={13} height={13} /></button>
              </div>
            ]
          })}
        </div>
      )}

      <div className="ai-msgs" ref={listRef} hidden={view !== 'chat'}>
        {msgs.length === 0 && (
          <div className="ai-welcome">
            <p>Ask anything about your data or the query in the editor. I can see the query{ctx.selection ? ', your selection' : ''}{lastError ? ' and the last error' : ''}, and I type SQL straight into the editor.</p>
            <div className="ai-starters">
              {STARTERS.filter(([l]) => (l === 'Fix the error' ? !!lastError : l === 'Write' || !!ctx.text.trim())).map(([l, q]) => (
                <button key={l} className="ai-starter" onClick={() => send(q)}>{l}</button>
              ))}
              <button className="ai-starter" onClick={() => { setInput('Write a query that '); inputRef.current?.focus() }}>Write a new query…</button>
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user'
          ? <div key={i} className="ai-msg user">{m.content}</div>
          : (
            <div key={i} className="ai-msg assistant">
              {segments(m.content).map((s, k) => s.kind === 'text'
                ? <Markdown key={k} text={s.body} />
                : (
                  <div key={k} className="ai-code">
                    <pre>{s.body}{s.open && m.streaming ? <span className="ai-caret" /> : null}</pre>
                    {!s.open && (
                      <div className="ai-code-actions">
                        <button className="btn btn-sm" onClick={() => editor.replace(s.body)} title="Replace the whole query in the editor">Replace query</button>
                        <button className="btn btn-sm" onClick={() => editor.insert(s.body)} title="Insert at the cursor (or over the selection)">Insert</button>
                        <button className="btn btn-sm" onClick={() => runCode(i, s.body)} title="Run this SQL; the result is saved in the chat"><IconPlay width={11} height={11} /> Run</button>
                        <button className="icon-btn" onClick={() => navigator.clipboard?.writeText(s.body)} title="Copy"><IconCopy width={13} height={13} /></button>
                      </div>
                    )}
                  </div>
                ))}
              {m.ran && (
                <details className={`ai-ran ${m.ran.error ? 'err' : ''}`} open={!!m.ran.preview && m.ran.preview.rows.length <= 5}>
                  <summary>{m.ran.error ? `Ran with an error: ${m.ran.error}` : `Ran: ${m.ran.rows?.toLocaleString() ?? 0} rows · ${m.ran.ms ?? '?'} ms`}<span className="muted"> · {new Date(m.ran.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span></summary>
                  {m.ran.preview && (
                    <div className="ai-ran-table">
                      <table>
                        <thead><tr>{m.ran.preview.columns.map((c, k) => <th key={k}>{c}</th>)}</tr></thead>
                        <tbody>{m.ran.preview.rows.map((r, k) => <tr key={k}>{r.map((v, j) => <td key={j}>{v === null || v === undefined ? <span className="muted">NULL</span> : cellText(v).slice(0, 60)}</td>)}</tr>)}</tbody>
                      </table>
                      {(m.ran.rows ?? 0) > m.ran.preview.rows.length && <div className="muted small-text">First {m.ran.preview.rows.length} of {m.ran.rows?.toLocaleString()} rows</div>}
                    </div>
                  )}
                </details>
              )}
              {m.streaming && !m.content && <div className="ai-typing"><span /><span /><span /></div>}
              {m.error && <div className="notice error">{m.error}</div>}
            </div>
          ))}
      </div>

      <div className="ai-compose" hidden={view !== 'chat'}>
        <div className="ai-ctx">
          <button className={`ai-chip ${useCtx.query && ctx.text.trim() ? 'on' : ''}`} disabled={!ctx.text.trim()} onClick={() => setUseCtx((c) => ({ ...c, query: !c.query }))}
            title="Send the editor's query (and selection) with your message">
            {ctx.selection ? `Selection · ${ctx.selection.split('\n').length} lines` : ctx.text.trim() ? `Query · ${ctx.lineCount} lines · cursor L${ctx.cursorLine}` : 'Editor empty'}
          </button>
          {lastError && <button className={`ai-chip err ${useCtx.error ? 'on' : ''}`} onClick={() => setUseCtx((c) => ({ ...c, error: !c.error }))} title={lastError}>Last error</button>}
          <span className="spacer" />
          <select className="ai-live" value={live} onChange={(e) => setLive(e.target.value as LiveMode)} title="How SQL from the answer goes into the editor">
            <option value="replace">Type into editor: replace query</option>
            <option value="cursor">Type into editor: at cursor</option>
            <option value="off">Don't type into editor</option>
          </select>
        </div>
        <div className="ai-input">
          <textarea ref={inputRef} value={input} rows={2} onChange={(e) => setInput(e.target.value)}
            placeholder={msgs.length ? 'Ask a follow-up… (Enter to send, Shift+Enter for a new line)' : 'e.g. top 10 customers by total spend this year'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }} />
          {busyId
            ? <button className="btn btn-sm" onClick={stop} title="Stop"><IconStop width={12} height={12} /> Stop</button>
            : <button className="btn btn-sm btn-primary" onClick={() => send(input)} disabled={!input.trim()}>Send</button>}
        </div>
        <p className="muted small-text ai-note">Sends table and column names and your query to {prov?.label ?? 'the AI provider'}; never row data. Review SQL before running it.</p>
      </div>
    </aside>
  )
}
